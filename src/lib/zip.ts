import JSZip from 'jszip';
import { ProcessedImage } from '../types';
import { genId } from './id';
import type { ImageExtractionResult } from './pages';

export async function extractImagesFromZip(file: File): Promise<ImageExtractionResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error(`"${file.name}" isn't a valid ZIP file${err instanceof Error ? `: ${err.message}` : ''}`);
  }

  const images: ProcessedImage[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir || filename.startsWith('__MACOSX/')) continue;

    // Check if it's an image
    const isImage = filename.match(/\.(jpeg|jpg|png|webp|gif)$/i);
    if (!isImage) continue;

    const basename = filename.split('/').pop() || filename;

    try {
      const base64 = await zipEntry.async('base64');
      let mimeType = 'image/jpeg';
      if (filename.toLowerCase().endsWith('.png')) mimeType = 'image/png';
      else if (filename.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
      else if (filename.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';

      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Get image dimensions
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => reject(new Error('unreadable image data'));
        img.src = dataUrl;
      });

      images.push({
        id: genId('img'),
        filename: basename,
        dataUrl,
        mimeType,
        width: dimensions.width,
        height: dimensions.height,
      });
    } catch (err) {
      skipped.push({ filename: basename, reason: err instanceof Error ? err.message : 'failed to decode' });
    }
  }

  // Sort naturally by filename
  images.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
  return { images, skipped };
}
