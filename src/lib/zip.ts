import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
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

    // Wait for fonts to be ready
    if ('fonts' in document) {
      await (document as any).fonts.ready;
    }

    // Use Konva purely to achieve exact 1-to-1 match with ImageEditor component preview
    // @ts-ignore
    const Konva = window.Konva || await import('konva').then(m => m.default || m);
    
    // Create headless stage
    const container = document.createElement('div');
    const stage = new Konva.Stage({ container, width: img.width, height: img.height });
    
    // We only use ONE layer, exactly like ImageEditor.tsx, so that globalCompositeOperation="destination-out" 
    // punches through everything properly (like background image).
    const mainLayer = new Konva.Layer();
    
    const imageObj = new Image();
    await new Promise((resolve, reject) => {
      imageObj.onload = resolve;
      imageObj.onerror = reject;
      imageObj.src = img.dataUrl;
    });
    
    const konvaImg = new Konva.Image({ image: imageObj, x: 0, y: 0, width: img.width, height: img.height });
    mainLayer.add(konvaImg);
    
    // Region Backgrounds
    img.regions.forEach(region => {
      if (region.bgColor !== 'transparent') {
        const group = new Konva.Group({
          x: region.x + region.width / 2,
          y: region.y + region.height / 2,
          rotation: region.angle,
          offset: { x: region.width / 2, y: region.height / 2 }
        });
        const rect = new Konva.Rect({
          width: region.width,
          height: region.height,
          fill: region.bgColor,
          cornerRadius: region.type === 'bubble' ? 10 : 0
        });
        group.add(rect);
        mainLayer.add(group);
      }
    });

    // Paint Strokes (including bg_erase and gen_erase)
    for (const stroke of img.paintStrokes) {
      if (stroke.imageBase64 && stroke.rect) {
        const patchImg = new Image();
        await new Promise((resolve, reject) => {
          patchImg.onload = resolve;
          patchImg.onerror = reject;
          patchImg.src = stroke.imageBase64!.startsWith('data:') ? stroke.imageBase64! : `data:image/jpeg;base64,${stroke.imageBase64}`;
        });
        const patchNode = new Konva.Image({
          image: patchImg,
          x: stroke.rect.x,
          y: stroke.rect.y,
          width: stroke.rect.w,
          height: stroke.rect.h
        });
        mainLayer.add(patchNode);
      } else {
        const line = new Konva.Line({
          points: stroke.points,
          stroke: stroke.tool === 'fill_poly' ? (stroke.points.length === 8 ? 'transparent' : stroke.color) : stroke.color,
          strokeWidth: stroke.tool === 'fill_poly' ? Math.max(1, stroke.size) : stroke.size,
          fill: stroke.tool === 'fill_poly' ? stroke.color : undefined,
          closed: stroke.tool === 'fill_poly',
          tension: stroke.tool === 'fill_poly' ? 0 : 0.5,
          lineCap: 'round',
          lineJoin: 'round',
          globalCompositeOperation: stroke.tool === 'bg_erase' ? 'destination-out' : 'source-over'
        });
        mainLayer.add(line);
      }
    }

    // Texts (these need to go on mainLayer too)
    img.regions.forEach(region => {
      const group = new Konva.Group({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        rotation: region.angle
      });
      
      const text = new Konva.Text({
        text: region.translatedText ? region.translatedText.split('\n').map(line => '\u202B' + line + '\u200F').join('\n') : '',
        width: region.width,
        height: region.height,
        fill: region.textColor,
        stroke: region.strokeColor !== 'transparent' ? region.strokeColor : undefined,
        strokeWidth: region.strokeColor !== 'transparent' ? region.strokeWidth : 0,
        fontFamily: region.fontFamily,
        fontSize: region.fontSize,
        fontStyle: `${region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`,
        align: region.textAlign,
        verticalAlign: 'middle',
        wrap: 'word',
        lineHeight: region.lineHeight,
        fillAfterStrokeEnabled: true
      });
      group.add(text);
      mainLayer.add(group);
    });
    stage.add(mainLayer);
    
    // Wait for a brief moment to ensure fonts are drawn
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Convert to DataURL and push to zip
    const dataUrl = stage.toDataURL({ mimeType: img.mimeType || 'image/png', quality: 1.0, pixelRatio: 1 });
    zip.file(newFilename, dataUrl.split(',')[1], { base64: true });
    
    // Cleanup
    stage.destroy();
  }

  if (setProgress) setProgress('Zipping files...');
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'translated_manga.zip');
}

export async function downloadSingleImage(img: ProcessedImage) {
  if ('fonts' in document) await (document as any).fonts.ready;
  // @ts-ignore
  const Konva = window.Konva || await import('konva').then(m => m.default || m);
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: img.width, height: img.height });
  const mainLayer = new Konva.Layer();
  
  const imageObj = new Image();
  await new Promise((resolve, reject) => {
    imageObj.onload = resolve; imageObj.onerror = reject; imageObj.src = img.dataUrl;
  });
  mainLayer.add(new Konva.Image({ image: imageObj, x: 0, y: 0, width: img.width, height: img.height }));
  
  img.regions.forEach(region => {
    if (region.bgColor !== 'transparent') {
      const group = new Konva.Group({ x: region.x + region.width / 2, y: region.y + region.height / 2, rotation: region.angle, offset: { x: region.width / 2, y: region.height / 2 } });
      group.add(new Konva.Rect({ width: region.width, height: region.height, fill: region.bgColor, cornerRadius: region.type === 'bubble' ? 10 : 0 }));
      mainLayer.add(group);
    }
  });

  for (const stroke of img.paintStrokes) {
    if (stroke.imageBase64 && stroke.rect) {
      const patchImg = new Image();
      await new Promise((resolve, reject) => { patchImg.onload = resolve; patchImg.onerror = reject; patchImg.src = stroke.imageBase64!.startsWith('data:') ? stroke.imageBase64! : `data:image/jpeg;base64,${stroke.imageBase64}`; });
      mainLayer.add(new Konva.Image({ image: patchImg, x: stroke.rect.x, y: stroke.rect.y, width: stroke.rect.w, height: stroke.rect.h }));
    } else {
      mainLayer.add(new Konva.Line({ points: stroke.points, stroke: stroke.tool === 'fill_poly' ? (stroke.points.length === 8 ? 'transparent' : stroke.color) : stroke.color, strokeWidth: stroke.tool === 'fill_poly' ? Math.max(1, stroke.size) : stroke.size, fill: stroke.tool === 'fill_poly' ? stroke.color : undefined, closed: stroke.tool === 'fill_poly', tension: stroke.tool === 'fill_poly' ? 0 : 0.5, lineCap: 'round', lineJoin: 'round', globalCompositeOperation: stroke.tool === 'bg_erase' ? 'destination-out' : 'source-over' }));
    }
  }

  img.regions.forEach(region => {
    const group = new Konva.Group({ x: region.x, y: region.y, width: region.width, height: region.height, rotation: region.angle });
    group.add(new Konva.Text({ text: region.translatedText ? region.translatedText.split('\n').map(line => '\u202B' + line + '\u200F').join('\n') : '', width: region.width, height: region.height, fill: region.textColor, stroke: region.strokeColor !== 'transparent' ? region.strokeColor : undefined, strokeWidth: region.strokeColor !== 'transparent' ? region.strokeWidth : 0, fontFamily: region.fontFamily, fontSize: region.fontSize, fontStyle: `${region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`, align: region.textAlign, verticalAlign: 'middle', wrap: 'word', lineHeight: region.lineHeight, fillAfterStrokeEnabled: true }));
    mainLayer.add(group);
  });
  
  stage.add(mainLayer);
  await new Promise(resolve => setTimeout(resolve, 50));
  const dataUrl = stage.toDataURL({ mimeType: img.mimeType || 'image/png', quality: 1.0, pixelRatio: 1 });
  stage.destroy();

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `translated-${img.filename}`;
  a.click();
}

export async function downloadPdf(processedImages: ProcessedImage[], setProgress?: (p: string) => void) {
  const pdf = new jsPDF();
  let isFirstPage = true;

  for (let idx = 0; idx < processedImages.length; idx++) {
    const img = processedImages[idx];
    if (setProgress) setProgress(`Processing PDF page ${idx + 1} of ${processedImages.length}...`);

    let finalDataUrl = img.dataUrl;

    if (img.status === 'done' && img.regions.length > 0) {
      if ('fonts' in document) await (document as any).fonts.ready;
      // @ts-ignore
      const Konva = window.Konva || await import('konva').then(m => m.default || m);
      const container = document.createElement('div');
      const stage = new Konva.Stage({ container, width: img.width, height: img.height });
      const mainLayer = new Konva.Layer();
      
      const imageObj = new Image();
      await new Promise((resolve, reject) => {
        imageObj.onload = resolve; imageObj.onerror = reject; imageObj.src = img.dataUrl;
      });
      mainLayer.add(new Konva.Image({ image: imageObj, x: 0, y: 0, width: img.width, height: img.height }));
      
      img.regions.forEach(region => {
        if (region.bgColor !== 'transparent') {
          const group = new Konva.Group({ x: region.x + region.width / 2, y: region.y + region.height / 2, rotation: region.angle, offset: { x: region.width / 2, y: region.height / 2 } });
          group.add(new Konva.Rect({ width: region.width, height: region.height, fill: region.bgColor, cornerRadius: region.type === 'bubble' ? 10 : 0 }));
          mainLayer.add(group);
        }
      });

      for (const stroke of img.paintStrokes) {
        if (stroke.imageBase64 && stroke.rect) {
          const patchImg = new Image();
          await new Promise((resolve, reject) => { patchImg.onload = resolve; patchImg.onerror = reject; patchImg.src = stroke.imageBase64!.startsWith('data:') ? stroke.imageBase64! : `data:image/jpeg;base64,${stroke.imageBase64}`; });
          mainLayer.add(new Konva.Image({ image: patchImg, x: stroke.rect.x, y: stroke.rect.y, width: stroke.rect.w, height: stroke.rect.h }));
        } else {
          mainLayer.add(new Konva.Line({ points: stroke.points, stroke: stroke.tool === 'fill_poly' ? (stroke.points.length === 8 ? 'transparent' : stroke.color) : stroke.color, strokeWidth: stroke.tool === 'fill_poly' ? Math.max(1, stroke.size) : stroke.size, fill: stroke.tool === 'fill_poly' ? stroke.color : undefined, closed: stroke.tool === 'fill_poly', tension: stroke.tool === 'fill_poly' ? 0 : 0.5, lineCap: 'round', lineJoin: 'round', globalCompositeOperation: stroke.tool === 'bg_erase' ? 'destination-out' : 'source-over' }));
        }
      }

      img.regions.forEach(region => {
        const group = new Konva.Group({ x: region.x, y: region.y, width: region.width, height: region.height, rotation: region.angle });
        group.add(new Konva.Text({ text: region.translatedText ? region.translatedText.split('\n').map(line => '\u202B' + line + '\u200F').join('\n') : '', width: region.width, height: region.height, fill: region.textColor, stroke: region.strokeColor !== 'transparent' ? region.strokeColor : undefined, strokeWidth: region.strokeColor !== 'transparent' ? region.strokeWidth : 0, fontFamily: region.fontFamily, fontSize: region.fontSize, fontStyle: `${region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`, align: region.textAlign, verticalAlign: 'middle', wrap: 'word', lineHeight: region.lineHeight, fillAfterStrokeEnabled: true }));
        mainLayer.add(group);
      });
      stage.add(mainLayer);
      await new Promise(resolve => setTimeout(resolve, 50));
      finalDataUrl = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.9, pixelRatio: 1 });
      stage.destroy();
    }

    const imgProps = pdf.getImageProperties(finalDataUrl);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    if (!isFirstPage) {
      pdf.addPage([pdfWidth, pdfHeight]);
    } else {
      isFirstPage = false;
      pdf.setPage(1);
      pdf.internal.pageSize.setWidth(pdfWidth);
      pdf.internal.pageSize.setHeight(pdfHeight);
    }
    
    pdf.addImage(finalDataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
  }

  if (setProgress) setProgress('Generating PDF...');
  pdf.save('translated_manga.pdf');
}
