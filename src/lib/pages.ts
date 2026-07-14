import { ProcessedImage, Page } from '../types';
import { genId } from './id';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
/** Generous cap for high-res manga scans — large enough that legitimate pages never hit it. */
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export interface ImageExtractionResult {
  images: ProcessedImage[];
  /** Files that were selected but couldn't be imported, with a human-readable reason. */
  skipped: { filename: string; reason: string }[];
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function readDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Reads a set of individually-selected image files (not a zip) into ProcessedImages, sorted naturally by filename. */
export async function extractImagesFromFiles(files: FileList | File[]): Promise<ImageExtractionResult> {
  const all = Array.from(files);
  const skipped: { filename: string; reason: string }[] = [];

  const list = all.filter((f) => {
    if (!IMAGE_EXT.test(f.name)) {
      skipped.push({ filename: f.name, reason: 'unsupported file type' });
      return false;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      skipped.push({ filename: f.name, reason: `too large (${(f.size / (1024 * 1024)).toFixed(1)}MB, max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB)` });
      return false;
    }
    return true;
  });

  const results = await Promise.all(list.map(async (file): Promise<ProcessedImage | null> => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { width, height } = await readDimensions(dataUrl);
      return {
        id: genId('img'),
        filename: file.name,
        dataUrl,
        mimeType: mimeFromFilename(file.name),
        width,
        height,
      };
    } catch {
      skipped.push({ filename: file.name, reason: 'failed to read file' });
      return null;
    }
  }));

  const images = results
    .filter((img): img is ProcessedImage => img !== null)
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
  return { images, skipped };
}

export function createPagesFromOriginals(images: ProcessedImage[]): Page[] {
  return images.map((original, index) => ({
    id: genId('page'),
    order: index,
    original,
    cleaned: null,
  }));
}

/** Strips extension + common "clean/bleach" markers so "page01_clean.png" lines up with "page01.png". */
function normalizeForMatch(filename: string): string {
  return filename
    .replace(IMAGE_EXT, '')
    .replace(/[_\-\s]*(clean(ed)?|bleach(ed)?|raw|src)[_\-\s]*/gi, '')
    .toLowerCase()
    .trim();
}

/** Pulls the last run of digits out of a filename (e.g. "ch42_p07.png" -> 7) for numeric page-sync. */
function extractPageNumber(filename: string): number | null {
  const matches = normalizeForMatch(filename).match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return parseInt(matches[matches.length - 1], 10);
}

export interface PairingSuggestion {
  pages: Page[];
  /** Cleaned images that could not be confidently matched and need manual placement. */
  unmatched: ProcessedImage[];
}

/**
 * Suggests cleaned-page pairings for a set of pages: first pass matches by
 * normalized filename, remaining images fall back to matching by position
 * among still-unpaired pages. Callers should surface this as an editable
 * suggestion, not a final assignment.
 */
export function suggestPairing(pages: Page[], cleanedImages: ProcessedImage[]): PairingSuggestion {
  const result = pages.map(p => ({ ...p }));
  const remaining = [...cleanedImages];

  // Pass 1: filename match
  for (const page of result) {
    if (page.cleaned) continue;
    const key = normalizeForMatch(page.original.filename);
    const matchIndex = remaining.findIndex(img => normalizeForMatch(img.filename) === key);
    if (matchIndex !== -1) {
      page.cleaned = remaining[matchIndex];
      remaining.splice(matchIndex, 1);
    }
  }

  // Pass 2: numeric page-number match (e.g. "Page_1.jpg" <-> "01_cleaned.png") for filenames
  // that don't line up textually but refer to the same page number.
  for (const page of result) {
    if (page.cleaned) continue;
    const pageNum = extractPageNumber(page.original.filename);
    if (pageNum == null) continue;
    const matchIndex = remaining.findIndex(img => extractPageNumber(img.filename) === pageNum);
    if (matchIndex !== -1) {
      page.cleaned = remaining[matchIndex];
      remaining.splice(matchIndex, 1);
    }
  }

  // Pass 3: positional fallback for whatever's left, in order
  const unpairedPages = result.filter(p => !p.cleaned);
  for (let i = 0; i < unpairedPages.length && i < remaining.length; i++) {
    unpairedPages[i].cleaned = remaining[i];
  }
  const usedCount = Math.min(unpairedPages.length, remaining.length);
  const unmatched = remaining.slice(usedCount);

  return { pages: result, unmatched };
}
