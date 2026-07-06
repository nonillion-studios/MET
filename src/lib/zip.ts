import JSZip from 'jszip';
import { ProcessedImage } from '../types';

export async function extractImagesFromZip(file: File): Promise<ProcessedImage[]> {
  const zip = await JSZip.loadAsync(file);
  const images: ProcessedImage[] = [];

  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir || filename.startsWith('__MACOSX/')) continue;

    // Check if it's an image
    const isImage = filename.match(/\.(jpeg|jpg|png|webp|gif)$/i);
    if (!isImage) continue;

    const base64 = await zipEntry.async('base64');
    let mimeType = 'image/jpeg';
    if (filename.toLowerCase().endsWith('.png')) mimeType = 'image/png';
    else if (filename.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
    else if (filename.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';

    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Get image dimensions
    const dimensions = await new Promise<{width: number, height: number}>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.src = dataUrl;
    });

    const basename = filename.split('/').pop() || filename;

    images.push({
      id: Math.random().toString(36).substr(2, 9),
      filename: basename,
      dataUrl,
      mimeType,
      width: dimensions.width,
      height: dimensions.height
    });
  }

  // Sort naturally by filename
  return images.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
}
