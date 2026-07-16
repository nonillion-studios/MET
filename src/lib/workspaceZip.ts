import JSZip from 'jszip';
import type { Chapter, MangaSeries, Page, ProcessedImage, Volume, Workspace } from '../types';
import { genId } from './id';

function sanitize(name: string): string {
  return name.replace(/[^\w\-]+/g, '_') || 'untitled';
}

function extFromMimeType(mimeType: string): string {
  const match = /\/([a-z0-9.+-]+)$/i.exec(mimeType);
  return match ? match[1].replace('jpeg', 'jpg') : 'png';
}

async function addImageFile(folder: JSZip, filename: string, image: ProcessedImage) {
  const blob = await (await fetch(image.dataUrl)).blob();
  folder.file(filename, blob);
}

async function addChapterFiles(folder: JSZip, chapter: Chapter) {
  for (const page of chapter.pages) {
    const index = String(page.order + 1).padStart(3, '0');
    const originalExt = extFromMimeType(page.original.mimeType);
    const originalName = page.original.filename || `page-${index}.${originalExt}`;
    await addImageFile(folder, `page-${index}_${sanitize(originalName)}`, page.original);
    if (page.cleaned) {
      const cleanedExt = extFromMimeType(page.cleaned.mimeType);
      const cleanedName = page.cleaned.filename || `page-${index}_cleaned.${cleanedExt}`;
      await addImageFile(folder, `page-${index}_cleaned_${sanitize(cleanedName)}`, page.cleaned);
    }
  }
}

async function addVolumeFolder(root: JSZip, volume: Volume) {
  const volumeFolder = root.folder(sanitize(volume.name));
  if (!volumeFolder) return;
  for (const chapter of volume.chapters) {
    const chapterFolder = volumeFolder.folder(sanitize(chapter.name));
    if (!chapterFolder) continue;
    await addChapterFiles(chapterFolder, chapter);
  }
}

async function addMangaFolder(root: JSZip, manga: MangaSeries) {
  const mangaFolder = root.folder(sanitize(manga.title));
  if (!mangaFolder) return;
  for (const volume of manga.volumes) {
    await addVolumeFolder(mangaFolder, volume);
  }
}

/** Bundles a workspace into a browsable folder-tree ZIP (manga/volume/chapter folders full of
 *  the actual page images), distinct from `.msp`'s single opaque project-data archive. */
export async function exportWorkspaceToZip(workspace: Workspace): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(workspace.name)) ?? zip;
  for (const manga of workspace.mangas) {
    await addMangaFolder(root, manga);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportMangaToZip(manga: MangaSeries): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(manga.title)) ?? zip;
  for (const volume of manga.volumes) {
    await addVolumeFolder(root, volume);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportVolumeToZip(volume: Volume): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(volume.name)) ?? zip;
  for (const chapter of volume.chapters) {
    const chapterFolder = root.folder(sanitize(chapter.name));
    if (!chapterFolder) continue;
    await addChapterFiles(chapterFolder, chapter);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportChapterToZip(chapter: Chapter): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(chapter.name)) ?? zip;
  await addChapterFiles(root, chapter);
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

/** Rebuilds a Workspace from a folder-tree ZIP produced by `exportWorkspaceToZip`/`exportMangaToZip`/
 *  `exportVolumeToZip`/`exportChapterToZip`. Falls back to synthetic manga/volume/chapter names for
 *  zips exported at a shallower scope (e.g. a chapter-only ZIP has no manga/volume folders). */
export async function importWorkspaceFromZip(file: File): Promise<Workspace> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error(`"${file.name}" isn't a valid ZIP file${err instanceof Error ? `: ${err.message}` : ''}`);
  }

  type PageFile = { chapterPath: string[]; base: string; entry: JSZip.JSZipObject };
  const pageFiles: PageFile[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path.startsWith('__MACOSX/')) continue;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(path)) continue;
    const parts = path.split('/').filter(Boolean);
    const base = parts.pop();
    if (!base) continue;
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

  const mangaMap = new Map<string, MangaSeries>();
  for (const [key, files] of grouped) {
    const parts = key.split('/').filter(Boolean);
    const chapterName = parts[parts.length - 1] || 'Chapter 1';
    const volumeName = parts[parts.length - 2] || 'Volume 1';
    const mangaTitle = parts[parts.length - 3] || 'Imported Series';

    let manga = mangaMap.get(mangaTitle);
    if (!manga) {
      manga = { id: genId('manga'), title: mangaTitle, type: 'manga', coverUrl: '', description: '', volumes: [] };
      mangaMap.set(mangaTitle, manga);
    }
    let volume = manga.volumes.find(v => v.name === volumeName);
    if (!volume) {
      volume = { id: genId('volume'), name: volumeName, coverUrl: '', chapters: [] };
      manga.volumes.push(volume);
    }
    let chapter = volume.chapters.find(c => c.name === chapterName);
    if (!chapter) {
      chapter = { id: genId('chapter'), name: chapterName, coverUrl: '', pages: [] };
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
      const cleaned = rec.cleaned && rec.original ? await zipEntryToProcessedImage(rec.cleaned.entry, rec.cleaned.base) : null;
      pages.push({ id: genId('page'), order: pages.length, original, cleaned });
    }
    chapter.pages.push(...pages);
  }

  return {
    id: genId('workspace'),
    name: file.name.replace(/\.zip$/i, '') || 'Imported Workspace',
    description: '',
    coverUrl: '',
    tags: [],
    mangas: Array.from(mangaMap.values()),
  };
}
