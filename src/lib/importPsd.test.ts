import { describe, it, expect } from 'vitest';
import { mapPsdEffects, mapPsdTextLayer } from './importPsd';
import type { LayerEffectsInfo, Layer as PsdLayer } from 'ag-psd';

/**
 * `mapPsdEffects` is exportPsd.ts's `psdEffects()` run in reverse (same field names, same px/pct/
 * color conventions) — these tests pin those conventions down directly against ag-psd's real
 * `LayerEffectsInfo` shape, without needing an actual binary .psd file or canvas/pixel decoding
 * (which the pure-effects-metadata mapping doesn't touch at all).
 */
describe('mapPsdEffects', () => {
  it('returns undefined when the layer has no effects at all', () => {
    expect(mapPsdEffects(undefined)).toBeUndefined();
  });

  it('maps every effect kind with correct px/pct/color conventions', () => {
    const info: LayerEffectsInfo = {
      dropShadow: [{
        enabled: true, blendMode: 'multiply', color: { r: 10, g: 20, b: 30 }, opacity: 0.75,
        angle: 120, useGlobalLight: true, distance: { units: 'Pixels', value: 5 },
        choke: { units: 'Pixels', value: 2 }, size: { units: 'Pixels', value: 8 }, layerConceals: true,
      }],
      innerShadow: [{
        enabled: true, blendMode: 'multiply', color: { r: 0, g: 0, b: 0 }, opacity: 0.5,
        angle: 90, useGlobalLight: false, distance: { units: 'Pixels', value: 3 },
        choke: { units: 'Pixels', value: 1 }, size: { units: 'Pixels', value: 4 },
      }],
      outerGlow: {
        enabled: true, blendMode: 'screen', color: { r: 255, g: 255, b: 0 }, opacity: 0.8,
        noise: 0.1, range: 0.5, jitter: 0.2, choke: { units: 'Pixels', value: 0 }, size: { units: 'Pixels', value: 12 },
      },
      innerGlow: {
        enabled: true, blendMode: 'screen', color: { r: 255, g: 0, b: 0 }, opacity: 0.6,
        noise: 0, range: 0.5, jitter: 0, technique: 'precise', source: 'center',
        choke: { units: 'Pixels', value: 0 }, size: { units: 'Pixels', value: 6 },
      },
      bevel: {
        enabled: true, style: 'inner bevel', technique: 'chisel hard', direction: 'up',
        size: { units: 'Pixels', value: 7 }, soften: { units: 'Pixels', value: 2 }, strength: 0.9,
        angle: 45, altitude: 30,
        highlightBlendMode: 'screen', highlightColor: { r: 255, g: 255, b: 255 }, highlightOpacity: 0.7,
        shadowBlendMode: 'multiply', shadowColor: { r: 0, g: 0, b: 0 }, shadowOpacity: 0.65,
      },
      satin: {
        enabled: true, blendMode: 'multiply', color: { r: 100, g: 50, b: 200 }, opacity: 0.4,
        distance: { units: 'Pixels', value: 9 }, size: { units: 'Pixels', value: 11 }, angle: 19, invert: true,
      },
      solidFill: [{ enabled: true, blendMode: 'normal', color: { r: 200, g: 0, b: 0 }, opacity: 1 }],
      gradientOverlay: [{
        enabled: true, blendMode: 'normal', opacity: 0.9, align: false, scale: 0.5, angle: 33,
        type: 'linear',
        gradient: {
          name: 'g', type: 'solid',
          colorStops: [
            { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
            { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: 0.5 },
          ],
          opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }, { opacity: 1, location: 1, midpoint: 0.5 }],
        },
      }],
      stroke: [{
        enabled: true, position: 'outside', fillType: 'color', blendMode: 'normal', opacity: 1,
        size: { units: 'Pixels', value: 3 }, color: { r: 0, g: 128, b: 255 },
      }],
    };

    const effects = mapPsdEffects(info);
    expect(effects).toBeDefined();
    if (!effects) return;

    expect(effects.dropShadow).toMatchObject({
      enabled: true, blendMode: 'multiply', color: '#0a141e', opacity: 75,
      angle: 120, useGlobalLight: true, distance: 5, spread: 2, size: 8, layerKnocksOut: true,
    });
    expect(effects.innerShadow).toMatchObject({
      enabled: true, blendMode: 'multiply', color: '#000000', opacity: 50,
      angle: 90, useGlobalLight: false, distance: 3, spread: 1, size: 4,
    });
    expect(effects.outerGlow).toMatchObject({
      enabled: true, blendMode: 'screen', color: '#ffff00', opacity: 80, noise: 10, range: 50, jitter: 20, spread: 0, size: 12,
    });
    expect(effects.innerGlow).toMatchObject({
      enabled: true, blendMode: 'screen', color: '#ff0000', opacity: 60, technique: 'precise', source: 'center', size: 6,
    });
    expect(effects.bevelEmboss).toMatchObject({
      enabled: true, style: 'inner-bevel', technique: 'chisel-hard', direction: 'up',
      size: 7, soften: 2, depth: 90, angle: 45, altitude: 30,
      highlightMode: 'screen', highlightColor: '#ffffff', highlightOpacity: 70,
      shadowMode: 'multiply', shadowColor: '#000000', shadowOpacity: 65,
    });
    expect(effects.satin).toMatchObject({
      enabled: true, blendMode: 'multiply', color: '#6432c8', opacity: 40, distance: 9, size: 11, angle: 19, invert: true,
    });
    expect(effects.colorOverlay).toMatchObject({ enabled: true, blendMode: 'normal', color: '#c80000', opacity: 100 });
    expect(effects.gradientOverlay).toMatchObject({
      enabled: true, blendMode: 'normal', opacity: 90, alignWithLayer: false, angle: 33, style: 'linear',
      gradient: { from: '#000000', to: '#ffffff' },
    });
    expect(effects.stroke).toMatchObject({
      enabled: true, size: 3, position: 'outside', blendMode: 'normal', opacity: 100, fillType: 'color', color: '#0080ff',
    });
    // No pattern-asset library exists in this app — Pattern Overlay must stay disabled/default even
    // when the source PSD's own pattern reference is present, per its own doc comment.
    expect(effects.patternOverlay.enabled).toBe(false);
  });

  it('leaves a disabled/absent effect at its default (enabled: false)', () => {
    const effects = mapPsdEffects({ dropShadow: [{ enabled: false, opacity: 1 }] });
    expect(effects).toBeDefined();
    expect(effects?.dropShadow.enabled).toBe(false);
    expect(effects?.innerGlow.enabled).toBe(false);
    expect(effects?.stroke.enabled).toBe(false);
  });
});

/**
 * `mapPsdTextLayer` converts one PSD text layer into a real, editable `'text'`-type `StudioLayer`
 * instead of the flattened raster every other layer gets — these tests exercise the field mapping
 * directly against plain ag-psd-shaped objects (no binary .psd file needed, mirroring
 * `mapPsdEffects`'s tests above), since the pure metadata mapping doesn't touch canvas/pixel data.
 */
describe('mapPsdTextLayer', () => {
  function psdTextLayer(text: PsdLayer['text'], overrides: Partial<PsdLayer> = {}): PsdLayer {
    return { name: 'My Layer', opacity: 1, blendMode: 'normal', hidden: false, text, ...overrides };
  }

  it('returns null for a present-but-empty text shell', () => {
    expect(mapPsdTextLayer(psdTextLayer({ text: undefined as unknown as string }))).toBeNull();
  });

  it('detects point text (no shapeType/bounds) and leaves autoWidth/fixedHeight accordingly', () => {
    const layer = mapPsdTextLayer(psdTextLayer({ text: 'Hello' }));
    expect(layer).not.toBeNull();
    expect(layer!.type).toBe('text');
    expect(layer!.text!.autoWidth).toBe(true);
    expect(layer!.text!.fixedHeight).toBeUndefined();
    expect(layer!.text!.content).toBe('Hello');
  });

  it('detects box text (shapeType box + finite positive bounds) and sets width/fixedHeight', () => {
    const layer = mapPsdTextLayer(psdTextLayer({
      text: 'Hello', shapeType: 'box', left: 10, top: 20, right: 210, bottom: 120,
    }));
    expect(layer!.text!.autoWidth).toBe(false);
    expect(layer!.text!.width).toBe(200);
    expect(layer!.text!.fixedHeight).toBe(100);
    expect(layer!.text!.x).toBe(10);
    expect(layer!.text!.y).toBe(20);
  });

  it('falls back to point text when bounds are missing or non-positive', () => {
    const layer = mapPsdTextLayer(psdTextLayer({ text: 'Hi', shapeType: 'box', left: 10, top: 10, right: 10, bottom: 10 }));
    expect(layer!.text!.autoWidth).toBe(true);
  });

  it('maps base style (font, size, faux bold/italic, tracking, fill color) onto the layer', () => {
    const layer = mapPsdTextLayer(psdTextLayer({
      text: 'Styled',
      style: {
        font: { name: 'Georgia' }, fontSize: 42, fauxBold: true, fauxItalic: true,
        tracking: 50, fillColor: { r: 200, g: 10, b: 10 },
      },
    }));
    const t = layer!.text!;
    expect(t.fontFamily).toBe('Georgia');
    expect(t.fontSize).toBe(42);
    expect(t.bold).toBe(true);
    expect(t.italic).toBe(true);
    expect(t.letterSpacing).toBe(50);
    expect(t.color).toBe('#c80a0a');
  });

  it('maps leading to a lineHeight multiplier, but keeps the default when auto-leading', () => {
    const withLeading = mapPsdTextLayer(psdTextLayer({ text: 'x', style: { fontSize: 20, leading: 30, autoLeading: false } }));
    expect(withLeading!.text!.lineHeight).toBeCloseTo(1.5, 5);

    const autoLeading = mapPsdTextLayer(psdTextLayer({ text: 'x', style: { fontSize: 20, leading: 30, autoLeading: true } }));
    expect(autoLeading!.text!.lineHeight).toBe(1.15);
  });

  it.each([
    ['left', 'left'], ['right', 'right'], ['center', 'center'],
    ['justify-left', 'justify'], ['justify-right', 'justify'], ['justify-center', 'justify'], ['justify-all', 'justify'],
  ] as const)('maps justification %s to align %s', (justification, align) => {
    const layer = mapPsdTextLayer(psdTextLayer({ text: 'x', paragraphStyle: { justification } }));
    expect(layer!.text!.align).toBe(align);
  });

  it('maps styleRuns to per-character runs, only overriding fields the run actually sets', () => {
    const layer = mapPsdTextLayer(psdTextLayer({
      text: 'ABCDE',
      style: { fontSize: 20, fillColor: { r: 0, g: 0, b: 0 } },
      styleRuns: [
        { length: 2, style: {} },
        { length: 3, style: { fillColor: { r: 255, g: 0, b: 0 }, fauxBold: true } },
      ],
    }));
    const runs = layer!.text!.runs;
    expect(runs.reduce((sum, r) => sum + r.length, 0)).toBe(5);
    const styledRun = runs.find((r) => r.color === '#ff0000');
    expect(styledRun).toBeDefined();
    expect(styledRun!.bold).toBe(true);
    expect(styledRun!.fontSize).toBeUndefined(); // not overridden by this run -> falls back to layer default
  });

  it('normalizes CR/CRLF line endings to LF, matching how this app stores content elsewhere', () => {
    const layer = mapPsdTextLayer(psdTextLayer({ text: 'line1\r\nline2\rline3' }));
    expect(layer!.text!.content).toBe('line1\nline2\nline3');
  });

  it('never imports a text layer as locked, matching every other PSD-imported layer', () => {
    const layer = mapPsdTextLayer(psdTextLayer({ text: 'x' }));
    expect(layer!.locked).toBe(false);
  });
});
