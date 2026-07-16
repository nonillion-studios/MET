import type { BrushPreset } from '../../../lib/brushStore';
import { strokeSegment, type PaintSettings } from './paintEngine';
import { NO_SELECTION } from './selection';

/** Builds the PaintSettings a preset represents. Colour/tool-level state comes from the caller. */
export function presetToSettings(
  preset: BrushPreset,
  base: { color: string; bgColor: string; tolerance: number; liquifyMode: PaintSettings['liquifyMode']; symmetry: PaintSettings['symmetry'] },
  tipMask?: HTMLCanvasElement,
): PaintSettings {
  return {
    size: preset.size,
    hardness: preset.hardness,
    opacity: preset.opacity,
    flow: preset.flow,
    spacing: preset.spacing,
    angle: preset.angle,
    roundness: preset.roundness,
    scatter: preset.scatter,
    smoothing: preset.smoothing,
    pressureSize: preset.pressureSize,
    pressureOpacity: preset.pressureOpacity,
    brushShape: preset.shape,
    tipMask,
    tipMaskId: preset.shape === 'image' ? preset.id : undefined,
    ...base,
  };
}

/**
 * Renders a preset as a tapered S-curve stroke, the way a brush picker should
 * show it: the thumbnail is drawn by the *real* engine (strokeSegment), so what
 * you see is literally what the brush paints — spacing gaps, scatter, angle and
 * roundness all show up, and a pressure-driven preset visibly tapers.
 *
 * Strokes are drawn at a size that fits the thumbnail rather than the preset's
 * own size, so a 4px pen and a 60px airbrush are still comparable at a glance.
 */
export function renderBrushThumbnail(
  canvas: HTMLCanvasElement,
  preset: BrushPreset,
  color: string,
  tipMask?: HTMLCanvasElement,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Fit the preset's size into the strip, but keep relative weight legible.
  const shown = Math.max(2, Math.min(h * 0.55, preset.size * 0.5));
  const settings = presetToSettings(
    { ...preset, size: shown, opacity: 1 },
    { color, bgColor: '#ffffff', tolerance: 32, liquifyMode: 'push', symmetry: 'none' },
    tipMask,
  );

  const pad = shown / 2 + 2;
  const steps = 48;
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = pad + (w - pad * 2) * t;
    // gentle S so angle/roundness read on both diagonals
    const y = h / 2 + Math.sin(t * Math.PI * 2) * (h * 0.18);
    if (prev) {
      // Ramp pressure 0.15 -> 1 -> 0.15 so pressure-driven presets show their taper.
      const pressure = 0.15 + 0.85 * Math.sin(t * Math.PI);
      strokeSegment(ctx, prev.x, prev.y, x, y, settings, 'brush', NO_SELECTION, pressure);
    }
    prev = { x, y };
  }
}
