import { describe, it, expect } from 'vitest';
import { mapPsdEffects } from './importPsd';
import type { LayerEffectsInfo } from 'ag-psd';

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
