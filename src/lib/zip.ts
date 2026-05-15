import JSZip from 'jszip';
import { saveAs } from 'file-saver';
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

    images.push({
      id: Math.random().toString(36).substr(2, 9),
      filename,
      dataUrl,
      mimeType,
      regions: [],
      paintStrokes: [],
      status: "idle",
      width: dimensions.width,
      height: dimensions.height
    });
  }

  // Sort alphabetically by filename
  return images.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function downloadProcessedZip(processedImages: ProcessedImage[], setProgress?: (msg: string) => void) {
  const zip = new JSZip();

  for (let idx = 0; idx < processedImages.length; idx++) {
    const img = processedImages[idx];
    if (setProgress) setProgress(`Processing page ${idx + 1} of ${processedImages.length}...`);
    
    // Rename sequentially
    const ext = img.filename.split('.').pop() || 'png';
    const newFilename = `page-${String(idx + 1).padStart(3, '0')}.${ext}`;

    if (img.status !== 'done' || img.regions.length === 0) {
      zip.file(newFilename, img.dataUrl.split(',')[1], { base64: true });
      continue;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Wait for fonts to be ready
    if ('fonts' in document) {
      await (document as any).fonts.ready;
    }

    // 1. Draw original background image
    const imageEl = new Image();
    await new Promise((resolve) => {
      imageEl.onload = resolve;
      imageEl.src = img.dataUrl;
    });
    ctx.drawImage(imageEl, 0, 0);

    // 2. Draw normal paint strokes (draw, fill_poly, erase, smart_sfx)
    for (const stroke of img.paintStrokes) {
      if (stroke.tool === 'bg_erase') continue; // Handled later
      if (stroke.points.length < 4) continue;
      
      ctx.beginPath();
      ctx.moveTo(stroke.points[0], stroke.points[1]);
      for (let i = 2; i < stroke.points.length; i += 2) {
        ctx.lineTo(stroke.points[i], stroke.points[i+1]);
      }

      if (stroke.tool === 'fill_poly') {
        ctx.closePath();
        ctx.fillStyle = stroke.color;
        ctx.fill();
        if (stroke.size > 0 && stroke.points.length !== 8) {
           ctx.strokeStyle = stroke.color;
           ctx.lineWidth = stroke.size;
           ctx.stroke();
        }
      } else {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (stroke.tool === 'erase') {
          ctx.strokeStyle = '#ffffff'; 
        }
        ctx.stroke();
      }
    }

    // 3. Draw Region Backgrounds & apply bg_erase using a temp canvas
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = img.width;
    bgCanvas.height = img.height;
    const bgCtx = bgCanvas.getContext('2d');
    if (bgCtx) {
      for (const region of img.regions) {
        if (region.bgColor !== 'transparent') {
          bgCtx.save();
          bgCtx.translate(region.x + region.width / 2, region.y + region.height / 2);
          bgCtx.rotate((region.angle * Math.PI) / 180);
          bgCtx.translate(-(region.x + region.width / 2), -(region.y + region.height / 2));
          
          bgCtx.fillStyle = region.bgColor;
          if (region.type === 'bubble') {
            bgCtx.beginPath();
            bgCtx.roundRect(region.x, region.y, region.width, region.height, 10);
            bgCtx.fill();
          } else {
            bgCtx.fillRect(region.x, region.y, region.width, region.height);
          }
          bgCtx.restore();
        }
      }

      // Apply bg_erase to the region backgrounds
      bgCtx.globalCompositeOperation = 'destination-out';
      for (const stroke of img.paintStrokes) {
        if (stroke.tool === 'bg_erase' && stroke.points.length >= 4) {
          bgCtx.beginPath();
          bgCtx.moveTo(stroke.points[0], stroke.points[1]);
          for (let i = 2; i < stroke.points.length; i += 2) {
            bgCtx.lineTo(stroke.points[i], stroke.points[i+1]);
          }
          bgCtx.strokeStyle = '#000000';
          bgCtx.lineWidth = stroke.size;
          bgCtx.lineCap = 'round';
          bgCtx.lineJoin = 'round';
          bgCtx.stroke();
        }
      }

      ctx.drawImage(bgCanvas, 0, 0);
    }

    // 4. Draw texts
    for (const region of img.regions) {
      ctx.save();
      
      ctx.translate(region.x + region.width / 2, region.y + region.height / 2);
      ctx.rotate((region.angle * Math.PI) / 180);
      ctx.translate(-(region.x + region.width / 2), -(region.y + region.height / 2));

      // Draw text
      if (region.strokeColor && region.strokeColor !== 'transparent' && region.strokeWidth > 0) {
        ctx.strokeStyle = region.strokeColor;
        ctx.lineWidth = region.strokeWidth;
        ctx.lineJoin = 'round';
      }
      
      const fontWeight = region.fontWeight && region.fontWeight !== 'normal' ? `${region.fontWeight} ` : '';
      const fontStyle = region.fontStyle && region.fontStyle !== 'normal' ? `${region.fontStyle} ` : '';
      
      ctx.fillStyle = region.textColor;
      ctx.font = `${fontStyle}${fontWeight}${region.fontSize}px "${region.fontFamily}"`;
      ctx.textAlign = region.textAlign as CanvasTextAlign || 'center';
      ctx.direction = 'rtl';
      ctx.textBaseline = 'middle';
      
      const paragraphs = region.translatedText.split('\n');
      const lines: string[] = [];
      const maxWidth = region.width * 0.95; 
      
      for (let p = 0; p < paragraphs.length; p++) {
        const words = paragraphs[p].split(' ');
        let currentLine = '';
        
        for (let w = 0; w < words.length; w++) {
          const testLine = currentLine + words[w] + ' ';
          const metrics = ctx.measureText('\u202B' + testLine + '\u200F');
          
          if (metrics.width > maxWidth && w > 0) {
            lines.push(currentLine.trim());
            currentLine = words[w] + ' ';
          } else {
            currentLine = testLine;
          }
        }
        lines.push(currentLine.trim());
      }

      const lineHeight = region.fontSize * (region.lineHeight || 1.2);
      const totalHeight = lines.length * lineHeight;
      const startY = region.y + region.height / 2 - totalHeight / 2 + lineHeight / 2;
      
      let startX = region.x + region.width / 2;
      if (ctx.textAlign === 'left') startX = region.x + 5;
      if (ctx.textAlign === 'right') startX = region.x + region.width - 5;

      lines.forEach((line, i) => {
        const formattedLine = '\u202B' + line + '\u200F';
        if (region.strokeColor && region.strokeColor !== 'transparent' && region.strokeWidth > 0) {
          ctx.strokeText(formattedLine, startX, startY + i * lineHeight);
        }
        ctx.fillText(formattedLine, startX, startY + i * lineHeight);
      });

      ctx.restore();
    }

    const dataUrl = canvas.toDataURL(img.mimeType || 'image/png', 1.0);
    zip.file(newFilename, dataUrl.split(',')[1], { base64: true });
  }

  if (setProgress) setProgress('Zipping files...');
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'translated_manga.zip');
}
