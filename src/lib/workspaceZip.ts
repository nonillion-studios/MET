import JSZip from 'jszip';
import type { Chapter, MangaSeries, Page, ProcessedImage, Volume, Workspace } from '../types';
import { genId } from './id';

const INFO_FILENAME = 'info.json';
const INFO_SCHEMA_VERSION = 1;

interface NodeInfo {
  name: string;
  description?: string;
  type?: 'manga' | 'manhwa';
}

export type ZipProgressCallback = (current: number, total: number) => void;

function sanitize(name: string): string {
  // \w is ASCII-only, so a non-Latin title (Japanese/Korean/Chinese, accented
  // Latin, etc. — common for manga/manhwa) used to have every character
  // stripped and collapse to the 'untitled' fallback. \p{L}/\p{N} keep any
  // script's letters/digits so the zip's folder/file names still visibly
  // match the title shown in the app.
  return name.trim().replace(/[^\p{L}\p{N}\-]+/gu, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

/** Like `sanitize`, but preserves the file extension — `sanitize` alone turns the dot in
 *  "page-001.png" into an underscore, which strips the extension `importWorkspaceFromZip`'s page
 *  regex relies on to recognize the file as an image at all. */
function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return sanitize(name);
  return `${sanitize(name.slice(0, dot))}.${name.slice(dot + 1).replace(/[^\w]+/g, '')}`;
}

function extFromMimeType(mimeType: string): string {
  const match = /\/([a-z0-9.+-]+)$/i.exec(mimeType);
  return match ? match[1].replace('jpeg', 'jpg') : 'png';
}

function extFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);/i.exec(dataUrl);
  return extFromMimeType(match ? match[1] : 'image/png');
}

async function addImageFile(folder: JSZip, filename: string, image: ProcessedImage) {
  const buffer = await (await fetch(image.dataUrl)).arrayBuffer();
  folder.file(filename, buffer);
}

/** Writes `info.json` (name/description/type) and, when a cover is set, `cover.<ext>` into a
 *  folder — this is what lets `importWorkspaceFromZip` restore metadata that a bare folder-tree
 *  of page images can't otherwise carry. */
async function addInfoAndCover(folder: JSZip, info: NodeInfo, coverUrl: string, progress?: { onProgress?: ZipProgressCallback; counter: { value: number }; total: number }) {
  folder.file(INFO_FILENAME, JSON.stringify({ schemaVersion: INFO_SCHEMA_VERSION, ...info }, null, 2));
  if (coverUrl) {
    const buffer = await (await fetch(coverUrl)).arrayBuffer();
    folder.file(`cover.${extFromDataUrl(coverUrl)}`, buffer);
    if (progress) {
      progress.counter.value += 1;
      progress.onProgress?.(progress.counter.value, progress.total);
    }
  }
}

async function addChapterFiles(folder: JSZip, chapter: Chapter, progress?: { onProgress?: ZipProgressCallback; counter: { value: number }; total: number }) {
  await addInfoAndCover(folder, { name: chapter.name }, chapter.coverUrl, progress);
  for (const page of chapter.pages) {
    const index = String(page.order + 1).padStart(3, '0');
    const originalExt = extFromMimeType(page.original.mimeType);
    const originalName = page.original.filename || `page-${index}.${originalExt}`;
    await addImageFile(folder, `page-${index}_${sanitizeFilename(originalName)}`, page.original);
    if (progress) {
      progress.counter.value += 1;
      progress.onProgress?.(progress.counter.value, progress.total);
    }
    if (page.cleaned) {
      const cleanedExt = extFromMimeType(page.cleaned.mimeType);
      const cleanedName = page.cleaned.filename || `page-${index}_cleaned.${cleanedExt}`;
      await addImageFile(folder, `page-${index}_cleaned_${sanitizeFilename(cleanedName)}`, page.cleaned);
      if (progress) {
        progress.counter.value += 1;
        progress.onProgress?.(progress.counter.value, progress.total);
      }
    }
  }
}

async function addVolumeFolder(root: JSZip, volume: Volume, progress?: { onProgress?: ZipProgressCallback; counter: { value: number }; total: number }) {
  const volumeFolder = root.folder(sanitize(volume.name));
  if (!volumeFolder) return;
  await addInfoAndCover(volumeFolder, { name: volume.name }, volume.coverUrl, progress);
  for (const chapter of volume.chapters) {
    const chapterFolder = volumeFolder.folder(sanitize(chapter.name));
    if (!chapterFolder) continue;
    await addChapterFiles(chapterFolder, chapter, progress);
  }
}

async function addMangaFolder(root: JSZip, manga: MangaSeries, progress?: { onProgress?: ZipProgressCallback; counter: { value: number }; total: number }) {
  const mangaFolder = root.folder(sanitize(manga.title));
  if (!mangaFolder) return;
  await addInfoAndCover(mangaFolder, { name: manga.title, description: manga.description, type: manga.type }, manga.coverUrl, progress);
  for (const volume of manga.volumes) {
    await addVolumeFolder(mangaFolder, volume, progress);
  }
}

/** Total number of progress-worthy steps (page images + cleaned variants + covers) in a subtree —
 *  precomputed once so the progress callback can report accurate `current/total` as the slow
 *  per-image `fetch`/blob steps run, rather than jumping in coarse, uneven chunks. */
function countChapterSteps(chapter: Chapter): number {
  let steps = chapter.coverUrl ? 1 : 0;
  for (const page of chapter.pages) {
    steps += 1;
    if (page.cleaned) steps += 1;
  }
  return steps;
}
function countVolumeSteps(volume: Volume): number {
  let steps = volume.coverUrl ? 1 : 0;
  for (const chapter of volume.chapters) steps += countChapterSteps(chapter);
  return steps;
}
function countMangaSteps(manga: MangaSeries): number {
  let steps = manga.coverUrl ? 1 : 0;
  for (const volume of manga.volumes) steps += countVolumeSteps(volume);
  return steps;
}
function countWorkspaceSteps(workspace: Workspace): number {
  let steps = workspace.coverUrl ? 1 : 0;
  for (const manga of workspace.mangas) steps += countMangaSteps(manga);
  return steps;
}

/** Bundles a workspace into a browsable folder-tree ZIP (manga/volume/chapter folders full of
 *  the actual page images), distinct from `.msp`'s single opaque project-data archive. Every
 *  folder also gets `info.json`/`cover.*` so `importWorkspaceFromZip` can restore names, cover
 *  art and (for series) description/type instead of only guessing from folder names. */
export async function exportWorkspaceToZip(workspace: Workspace, onProgress?: ZipProgressCallback): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(workspace.name)) ?? zip;
  const total = Math.max(1, countWorkspaceSteps(workspace));
  const progress = { onProgress, counter: { value: 0 }, total };
  await addInfoAndCover(root, { name: workspace.name, description: workspace.description }, workspace.coverUrl, progress);
  for (const manga of workspace.mangas) {
    await addMangaFolder(root, manga, progress);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportMangaToZip(manga: MangaSeries, onProgress?: ZipProgressCallback): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(manga.title)) ?? zip;
  const total = Math.max(1, countMangaSteps(manga));
  const progress = { onProgress, counter: { value: 0 }, total };
  await addInfoAndCover(root, { name: manga.title, description: manga.description, type: manga.type }, manga.coverUrl, progress);
  for (const volume of manga.volumes) {
    await addVolumeFolder(root, volume, progress);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportVolumeToZip(volume: Volume, onProgress?: ZipProgressCallback): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(volume.name)) ?? zip;
  const total = Math.max(1, countVolumeSteps(volume));
  const progress = { onProgress, counter: { value: 0 }, total };
  await addInfoAndCover(root, { name: volume.name }, volume.coverUrl, progress);
  for (const chapter of volume.chapters) {
    const chapterFolder = root.folder(sanitize(chapter.name));
    if (!chapterFolder) continue;
    await addChapterFiles(chapterFolder, chapter, progress);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportChapterToZip(chapter: Chapter, onProgress?: ZipProgressCallback): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(chapter.name)) ?? zip;
  const total = Math.max(1, countChapterSteps(chapter));
  const progress = { onProgress, counter: { value: 0 }, total };
  await addChapterFiles(root, chapter, progress);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadZip(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitize(name)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** @deprecated use `downloadZip` */
export const downloadWorkspaceZip = downloadZip;

async function zipEntryToProcessedImage(entry: JSZip.JSZipObject, filename: string): Promise<ProcessedImage> {
  const base64 = await entry.async('base64');
  let mimeType = 'image/jpeg';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) mimeType = 'image/png';
  else if (lower.endsWith('.webp')) mimeType = 'image/webp';
  else if (lower.endsWith('.gif')) mimeType = 'image/gif';
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('unreadable image data'));
    img.src = dataUrl;
  });
  return { id: genId('img'), filename, dataUrl, mimeType, width: dimensions.width, height: dimensions.height };
}

async function zipEntryToCoverDataUrl(entry: JSZip.JSZipObject, filename: string): Promise<string> {
  const base64 = await entry.async('base64');
  const lower = filename.toLowerCase();
  let mimeType = 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (lower.endsWith('.webp')) mimeType = 'image/webp';
  else if (lower.endsWith('.gif')) mimeType = 'image/gif';
  return `data:${mimeType};base64,${base64}`;
}

interface ParsedNodeInfo {
  name?: string;
  title?: string;
  description?: string;
  type?: 'manga' | 'manhwa';
}

/** Rebuilds a Workspace from a folder-tree ZIP produced by `exportWorkspaceToZip`/`exportMangaToZip`/
 *  `exportVolumeToZip`/`exportChapterToZip`. Falls back to synthetic manga/volume/chapter names for
 *  zips exported at a shallower scope (e.g. a chapter-only ZIP has no manga/volume folders), and
 *  for zips with no `info.json`/`cover.*` at all (legacy exports, or hand-built folders of images) —
 *  when present, `info.json`/`cover.*` at a folder's own path override the folder-name guess. */
export async function importWorkspaceFromZip(file: File, onProgress?: ZipProgressCallback): Promise<Workspace> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error(`"${file.name}" isn't a valid ZIP file${err instanceof Error ? `: ${err.message}` : ''}`);
  }

  const infoByPath = new Map<string, ParsedNodeInfo>();
  const coverByPath = new Map<string, { entry: JSZip.JSZipObject; filename: string }>();
  type PageFile = { chapterPath: string[]; base: string; entry: JSZip.JSZipObject };
  const pageFiles: PageFile[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path.startsWith('__MACOSX/')) continue;
    const parts = path.split('/').filter(Boolean);
    const base = parts.pop();
    if (!base) continue;
    const folderPath = parts.join('/');
    if (base === INFO_FILENAME) {
      try {
        infoByPath.set(folderPath, JSON.parse(await entry.async('text')));
      } catch {
        // malformed info.json — ignore, fall back to folder-name guessing for this node
      }
      continue;
    }
    if (/^cover\./i.test(base) && /\.(jpe?g|png|webp|gif)$/i.test(base)) {
      coverByPath.set(folderPath, { entry, filename: base });
      continue;
    }
    if (!/\.(jpe?g|png|webp|gif)$/i.test(path)) continue;
    pageFiles.push({ chapterPath: parts, base, entry });
  }
  if (pageFiles.length === 0) {
    throw new Error(`"${file.name}" doesn't contain any recognizable page images.`);
  }

  const grouped = new Map<string, PageFile[]>();
  for (const pf of pageFiles) {
    const key = pf.chapterPath.join('/');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(pf);
  }

  const total = pageFiles.length + coverByPath.size;
  let done = 0;
  const bump = () => { done += 1; onProgress?.(done, total); };

  const coverAt = async (folderPath: string): Promise<string> => {
    const cover = coverByPath.get(folderPath);
    if (!cover) return '';
    const dataUrl = await zipEntryToCoverDataUrl(cover.entry, cover.filename);
    bump();
    return dataUrl;
  };

  const mangaMap = new Map<string, MangaSeries>();
  let workspaceInfo: ParsedNodeInfo | undefined;
  let workspaceCoverUrl = '';

  for (const [key, files] of grouped) {
    const parts = key.split('/').filter(Boolean);
    const chapterPath = parts.join('/');
    const volumeParts = parts.slice(0, -1);
    const volumePath = volumeParts.join('/');
    const mangaParts = parts.slice(0, -2);
    const mangaPath = mangaParts.join('/');
    const workspaceParts = parts.slice(0, -3);
    const workspacePath = workspaceParts.join('/');

    const chapterInfo = infoByPath.get(chapterPath);
    const volumeInfo = parts.length >= 2 ? infoByPath.get(volumePath) : undefined;
    const mangaInfo = parts.length >= 3 ? infoByPath.get(mangaPath) : undefined;
    const wsInfo = parts.length >= 4 ? infoByPath.get(workspacePath) : undefined;
    if (wsInfo && !workspaceInfo) workspaceInfo = wsInfo;
    if (parts.length >= 4 && !workspaceCoverUrl) workspaceCoverUrl = await coverAt(workspacePath);

    const chapterName = chapterInfo?.name || parts[parts.length - 1] || 'Chapter 1';
    const volumeName = volumeInfo?.name || parts[parts.length - 2] || 'Volume 1';
    const mangaTitle = mangaInfo?.name || mangaInfo?.title || parts[parts.length - 3] || 'Imported Series';

    let manga = mangaMap.get(mangaTitle);
    if (!manga) {
      manga = {
        id: genId('manga'),
        title: mangaTitle,
        type: mangaInfo?.type === 'manhwa' ? 'manhwa' : 'manga',
        coverUrl: parts.length >= 3 ? await coverAt(mangaPath) : '',
        description: mangaInfo?.description || '',
        volumes: [],
      };
      mangaMap.set(mangaTitle, manga);
    }
    let volume = manga.volumes.find(v => v.name === volumeName);
    if (!volume) {
      volume = { id: genId('volume'), name: volumeName, coverUrl: parts.length >= 2 ? await coverAt(volumePath) : '', chapters: [] };
      manga.volumes.push(volume);
    }
    let chapter = volume.chapters.find(c => c.name === chapterName);
    if (!chapter) {
      chapter = { id: genId('chapter'), name: chapterName, coverUrl: await coverAt(chapterPath), pages: [] };
      volume.chapters.push(chapter);
    }

    // Group by the shared "page-NNN" index so an original and its "_cleaned_" counterpart pair up.
    const byIndex = new Map<string, { original?: PageFile; cleaned?: PageFile }>();
    for (const pf of files) {
      const match = /^page-(\d+)_(cleaned_)?(.*)$/i.exec(pf.base);
      const index = match ? match[1] : pf.base;
      const isCleaned = !!match?.[2];
      const rec = byIndex.get(index) ?? {};
      if (isCleaned) rec.cleaned = pf; else rec.original = pf;
      byIndex.set(index, rec);
    }

    const sortedIndices = Array.from(byIndex.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const pages: Page[] = [];
    for (const idx of sortedIndices) {
      const rec = byIndex.get(idx)!;
      const originalPf = rec.original ?? rec.cleaned;
      if (!originalPf) continue;
      const original = await zipEntryToProcessedImage(originalPf.entry, originalPf.base);
      bump();
      const cleaned = rec.cleaned && rec.original ? await zipEntryToProcessedImage(rec.cleaned.entry, rec.cleaned.base) : null;
      if (cleaned) bump();
      pages.push({ id: genId('page'), order: pages.length, original, cleaned });
    }
    chapter.pages.push(...pages);
  }

  return {
    id: genId('workspace'),
    name: workspaceInfo?.name || file.name.replace(/\.zip$/i, '') || 'Imported Workspace',
    description: workspaceInfo?.description || '',
    coverUrl: workspaceCoverUrl,
    tags: [],
    mangas: Array.from(mangaMap.values()),
  };
}
