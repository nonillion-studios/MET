import type { Psd, Layer as PsdLayer, LayerEffectGradientOverlay } from 'ag-psd';
import type { TextGradient } from '../components/studio/studioTypes';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';
import type { SerializedStudioLayer } from './studioProjectStore';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean.padEnd(6, '0');
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * Our angle is degrees clockwise from left-to-right in screen coords (y grows down), so 90 means
 * top-to-bottom. Photoshop measures gradient angle counter-clockwise with y up, where 90 means
 * bottom-to-top — so the two conventions are the same axis mirrored, and the angle negates.
 *
 * ag-psd normalizes stop `location`/`midpoint` to 0..1 and `opacity` to 0..1, scaling them on
 * write (see serializeGradient in ag-psd's descriptor.js) — these are not raw PSD 0..4096 units.
 */
function buildGradientOverlay(gradient: TextGradient): LayerEffectGradientOverlay {
  return {
    enabled: true,
    blendMode: 'normal',
    opacity: 1,
    align: true,
    scale: 1,
    type: 'linear',
    angle: -gradient.angle,
    gradient: {
      name: 'Text gradient',
      type: 'solid',
      colorStops: [
        { color: hexToRgb(gradient.from), location: 0, midpoint: 0.5 },
        { color: hexToRgb(gradient.to), location: 1, midpoint: 0.5 },
      ],
      opacityStops: [
        { opacity: 1, location: 0, midpoint: 0.5 },
        { opacity: 1, location: 1, midpoint: 0.5 },
      ],
    },
  };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode an image while building the PSD'));
    img.src = dataUrl;
  });
}

async function dataUrlToCanvas(dataUrl: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return canvas;
}

async function buildPsdLayer(layer: SerializedStudioLayer, width: number, height: number): Promise<PsdLayer> {
  const base: PsdLayer = {
    name: layer.name,
    opacity: layer.opacity,
    hidden: !layer.visible,
    blendMode: layer.blendMode,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
  };

  if (layer.raster) {
    base.canvas = await dataUrlToCanvas(layer.raster, width, height);
  } else if (layer.type === 'text' && layer.text) {
    const t = layer.text;
    const lineCount = t.content.split('\n').length || 1;
    // Editable text layer per ag-psd's LayerTextData — Photoshop can re-edit this directly.
    // Font family names pass through as-is; Photoshop substitutes if that font isn't installed
    // (documented limitation, not something we can resolve from the browser).
    base.text = {
      text: t.content,
      left: t.x,
      top: t.y,
      right: t.x + t.width,
      bottom: t.y + t.fontSize * t.lineHeight * lineCount,
      style: {
        font: { name: t.fontFamily },
        fontSize: t.fontSize,
        fauxBold: t.bold,
        fauxItalic: t.italic,
        fillColor: hexToRgb(t.color),
        ...(t.strokeWidth > 0 ? { strokeColor: hexToRgb(t.strokeColor), strokeFlag: true, outlineWidth: t.strokeWidth } : {}),
      },
    };
    // A gradient overlay is how gradient text is done by hand in Photoshop, and it stays editable
    // there. `style.fillColor` above is left as the flat colour underneath, so the layer still
    // degrades sensibly if the effect is switched off.
    if (t.gradient?.enabled) {
      base.effects = { gradientOverlay: [buildGradientOverlay(t.gradient)] };
    }
  }

  return base;
}

/** Builds a layered, editable-text PSD from a Studio export snapshot. Layer order in `snapshot.layers`
 *  is bottom-to-top (matching the Layers panel), which lines up with ag-psd's expected `children` order.
 *  ag-psd is a large dependency, so it's dynamically imported here rather than bundled into the main
 *  chunk — it only loads the moment someone actually exports a PSD. */
export async function exportPsd(snapshot: ExportSnapshot): Promise<Blob> {
  const { writePsdBuffer } = await import('ag-psd');
  const backgroundCanvas = await dataUrlToCanvas(snapshot.backgroundDataUrl, snapshot.width, snapshot.height);
  const layers = await Promise.all(
    snapshot.layers.filter(l => !l.isBackground).map(l => buildPsdLayer(l, snapshot.width, snapshot.height))
  );

  const psd: Psd = {
    width: snapshot.width,
    height: snapshot.height,
    children: [
      { name: 'Background', canvas: backgroundCanvas, top: 0, left: 0, bottom: snapshot.height, right: snapshot.width },
      ...layers,
    ],
  };

  const buffer = writePsdBuffer(psd);
  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}
