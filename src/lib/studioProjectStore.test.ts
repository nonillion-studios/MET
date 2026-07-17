import { describe, it, expect } from 'vitest';
import { mapTree, flattenTree } from '../components/studio/layerTree';
import type { SerializedStudioLayer } from './studioProjectStore';

/**
 * Studio.tsx splits saved layers into plain layer objects plus a flat raster side-map on load, and
 * rejoins them on autosave. Both walks have to reach *inside groups* — pixels live at every depth,
 * while the canvas registry stays flat and keyed by layer id. A walk that stops at the root loses
 * a grouped layer's pixels silently, which is the failure this file exists to catch.
 */

const S = (id: string, extra: Partial<SerializedStudioLayer> = {}): SerializedStudioLayer => ({
  id, type: 'clean-patch', name: id, visible: true, locked: false, opacity: 1, blendMode: 'normal', ...extra,
});

const saved = (): SerializedStudioLayer[] => [
  S('background', { type: 'background', isBackground: true }),
  S('A', { raster: 'data:A' }),
  S('grp', { type: 'group', children: [S('B', { raster: 'data:B' }), S('C')] }),
];

const strip = (layers: SerializedStudioLayer[]) => mapTree(layers, ({ raster: _raster, ...l }) => l);
const collect = (layers: SerializedStudioLayer[]) => {
  const out: Record<string, string> = {};
  for (const l of flattenTree(layers)) if (l.raster) out[l.id] = l.raster;
  return out;
};

describe('load: strip pixels into a flat side-map', () => {
  it('strips raster at every depth, keeping the tree shape', () => {
    const stripped = strip(saved());
    expect('raster' in stripped[1]).toBe(false);
    expect('raster' in stripped[2].children![0]).toBe(false);
    expect(stripped[2].children!.map((c) => c.id)).toEqual(['B', 'C']);
  });

  it('collects pixels from inside groups', () => {
    expect(collect(saved())).toEqual({ A: 'data:A', B: 'data:B' });
  });
});

describe('autosave: rejoin pixels', () => {
  it('reattaches live pixels at every depth', () => {
    const live: Record<string, string> = { A: 'data:A2', B: 'data:B2' };
    const merged = mapTree<SerializedStudioLayer>(strip(saved()), (l) =>
      live[l.id] ? { ...l, raster: live[l.id] } : l);

    expect(merged[1].raster).toBe('data:A2');
    expect(merged[2].children![0].raster).toBe('data:B2');
    expect(merged[2].children![1].raster).toBeUndefined();
  });

  it('round-trips without losing or reordering layers', () => {
    const merged = mapTree<SerializedStudioLayer>(strip(saved()), (l) => l);
    expect(flattenTree(merged).map((l) => l.id)).toEqual(flattenTree(saved()).map((l) => l.id));
  });
});

describe('v4 saves (flat, no groups)', () => {
  const v4 = (): SerializedStudioLayer[] => [
    S('background', { type: 'background', isBackground: true }),
    S('A', { raster: 'data:A' }),
  ];

  it('strips identically to the old flat map', () => {
    expect(strip(v4())).toEqual(v4().map(({ raster: _raster, ...l }) => l));
  });

  it('collects identically to the old flat loop', () => {
    expect(collect(v4())).toEqual({ A: 'data:A' });
  });
});
