import JSZip from 'jszip';
import type { ProcessedImage, Workspace } from '../types';

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

/** Bundles a workspace into a browsable folder-tree ZIP (manga/volume/chapter folders full of
 *  the actual page images), distinct from `.msp`'s single opaque project-data archive. */
export async function exportWorkspaceToZip(workspace: Workspace): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(sanitize(workspace.name)) ?? zip;

  for (const manga of workspace.mangas) {
    const mangaFolder = root.folder(sanitize(manga.title));
    if (!mangaFolder) continue;
    for (const volume of manga.volumes) {
      const volumeFolder = mangaFolder.folder(sanitize(volume.name));
      if (!volumeFolder) continue;
      for (const chapter of volume.chapters) {
        const chapterFolder = volumeFolder.folder(sanitize(chapter.name));
        if (!chapterFolder) continue;
        for (const page of chapter.pages) {
          const index = String(page.order + 1).padStart(3, '0');
          const originalExt = extFromMimeType(page.original.mimeType);
          const originalName = page.original.filename || `page-${index}.${originalExt}`;
          await addImageFile(chapterFolder, `page-${index}_${sanitize(originalName)}`, page.original);
          if (page.cleaned) {
            const cleanedExt = extFromMimeType(page.cleaned.mimeType);
            const cleanedName = page.cleaned.filename || `page-${index}_cleaned.${cleanedExt}`;
            await addImageFile(chapterFolder, `page-${index}_cleaned_${sanitize(cleanedName)}`, page.cleaned);
          }
        }
      }
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadWorkspaceZip(blob: Blob, workspaceName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitize(workspaceName)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
