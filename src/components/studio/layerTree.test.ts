import { describe, it, expect } from 'vitest';
import {
  flattenTree, flattenWithPaths, findLayer, findPath, getParent, collectSubtree,
  isDescendantOf, isEffectivelyVisible, isEffectivelyLocked, canMove,
  mapTree, updateLayer, removeLayers, insertAfter, insertInto, moveWithinParent, reparent,
  cloneSubtree, groupLayers, ungroup, partitionAdjustments, groupClipRuns,
} from './layerTree';
import type { StudioLayer } from './studioTypes';

/**
 * `layerTree` guards two invariants the rest of the Studio takes for granted — the background is
 * root index 0, and a tree never contains a cycle. Both are enforced by no-op-on-illegal-input
 * rather than by throwing, which makes them exactly the kind of thing that can silently rot. Hence
 * this file.
 *
 * The v4-compat block at the bottom is the load-bearing one: pre-group saves are flat arrays, and
 * every walker here has to treat them identically to the flat code it replaced.
 */

const L = (id: string, extra: Partial<StudioLayer> = {}): StudioLayer => ({
  id, type: 'clean-patch', name: id, visible: true, locked: false, opacity: 1, blendMode: 'normal', ...extra,
});
const G = (id: string, children: StudioLayer[], extra: Partial<StudioLayer> = {}): StudioLayer =>
  ({ ...L(id, extra), type: 'group', children });
const BG = L('background', { type: 'background', isBackground: true });

const ids = (ls: StudioLayer[]) => ls.map((l) => l.id).join(',');
/** [bg, A, grp(B, C), D] */
const tree = (): StudioLayer[] => [BG, L('A'), G('grp', [L('B'), L('C')]), L('D')];

describe('read', () => {
  it('flattens in paint order — children before their group', () => {
    expect(ids(flattenTree(tree()))).toBe('background,A,B,C,grp,D');
  });

  it('reports depth and path', () => {
    expect(flattenWithPaths(tree()).find((e) => e.layer.id === 'B')!.depth).toBe(1);
    expect(findPath(tree(), 'C')).toEqual([2, 1]);
  });

  it('finds nested layers', () => {
    expect(findLayer(tree(), 'C')?.id).toBe('C');
    expect(findLayer(tree(), 'nope')).toBeNull();
  });

  it('resolves parents', () => {
    expect(getParent(tree(), 'B')?.id).toBe('grp');
    expect(getParent(tree(), 'A')).toBeNull();
  });

  it('collects a subtree', () => {
    expect(ids(collectSubtree(tree()[2]))).toBe('grp,B,C');
  });

  it('detects descendants without counting self', () => {
    expect(isDescendantOf(tree(), 'B', 'grp')).toBe(true);
    expect(isDescendantOf(tree(), 'grp', 'grp')).toBe(false);
    expect(isDescendantOf(tree(), 'A', 'grp')).toBe(false);
  });

  it('inherits visibility and lock from ancestors', () => {
    expect(isEffectivelyVisible([BG, G('grp', [L('B')], { visible: false })], 'B')).toBe(false);
    expect(isEffectivelyVisible(tree(), 'B')).toBe(true);
    expect(isEffectivelyLocked([BG, G('grp', [L('B')], { locked: true })], 'B')).toBe(true);
    expect(isEffectivelyLocked(tree(), 'B')).toBe(false);
  });
});

describe('the background stays at root index 0', () => {
  it('never moves', () => {
    expect(canMove(tree(), 'background', 'up')).toBe(false);
    expect(ids(reparent(tree(), 'background', 'grp', 0))).toBe('background,A,grp,D');
  });

  it('nothing swaps under it', () => {
    expect(canMove(tree(), 'A', 'down')).toBe(false);
    expect(ids(moveWithinParent(tree(), 'A', 'down'))).toBe('background,A,grp,D');
  });

  it('nothing inserts under it', () => {
    expect(ids(insertInto(tree(), null, 0, L('X')))).toBe('background,X,A,grp,D');
  });

  it('is never deleted', () => {
    expect(ids(removeLayers(tree(), ['background']))).toContain('background');
  });
});

describe('write', () => {
  it('removes a layer with its whole subtree', () => {
    expect(ids(flattenTree(removeLayers(tree(), ['grp'])))).toBe('background,A,D');
    expect(ids(flattenTree(removeLayers(tree(), ['B'])))).toBe('background,A,C,grp,D');
  });

  it('inserts relative to a sibling at any depth', () => {
    expect(ids(insertAfter(tree(), 'A', L('X')))).toBe('background,A,X,grp,D');
    expect(ids(findLayer(insertAfter(tree(), 'B', L('X')), 'grp')!.children!)).toBe('B,X,C');
  });

  it('moves within the current parent only', () => {
    expect(ids(moveWithinParent(tree(), 'A', 'up'))).toBe('background,grp,A,D');
    expect(ids(findLayer(moveWithinParent(tree(), 'B', 'up'), 'grp')!.children!)).toBe('C,B');
  });

  it('refuses to insert into a non-group', () => {
    expect(ids(insertInto(tree(), 'A', 0, L('X')))).toBe('background,A,grp,D');
  });
});

describe('reparent', () => {
  it('moves into and out of groups', () => {
    const into = reparent(tree(), 'A', 'grp', 0);
    expect(ids(findLayer(into, 'grp')!.children!)).toBe('A,B,C');
    expect(ids(into)).toBe('background,grp,D');

    const out = reparent(tree(), 'B', null, 1);
    expect(ids(out)).toBe('background,B,A,grp,D');
    expect(ids(findLayer(out, 'grp')!.children!)).toBe('C');
  });

  it('refuses cycles', () => {
    expect(ids(reparent(tree(), 'grp', 'grp', 0))).toBe('background,A,grp,D');
    const deep = [BG, G('outer', [G('inner', [L('B')])])];
    expect(ids(reparent(deep, 'outer', 'inner', 0))).toBe('background,outer');
  });

  it('refuses a non-group parent', () => {
    expect(ids(reparent(tree(), 'A', 'D', 0))).toBe('background,A,grp,D');
  });

  it('reads the index against the post-detach list', () => {
    expect(ids(reparent(tree(), 'A', null, 3))).toBe('background,grp,D,A');
  });
});

describe('cloneSubtree', () => {
  it('regenerates every id and maps old to new', () => {
    const src = G('grp', [L('B', { mask: { id: 'mask-B', enabled: true, linked: true } }), L('C')]);
    const { copy, idMap } = cloneSubtree(src);

    expect(copy.id).not.toBe('grp');
    expect(copy.children![0].id).not.toBe('B');
    expect(idMap.get('grp')).toBe(copy.id);
    expect(idMap.get('B')).toBe(copy.children![0].id);
  });

  it('maps mask ids too — the mask registry is keyed separately from the layer', () => {
    const src = L('B', { mask: { id: 'mask-B', enabled: true, linked: true } });
    const { copy, idMap } = cloneSubtree(src);
    expect(idMap.get('mask-B')).toBe(copy.mask!.id);
  });

  it('renames only the root, and shares no nested objects', () => {
    const src = G('grp', [L('B', { mask: { id: 'mask-B', enabled: true, linked: true } })]);
    const { copy } = cloneSubtree(src);
    expect(copy.name).toBe('grp copy');
    expect(copy.children![0].name).toBe('B');
    expect(copy.children![0].mask).not.toBe(src.children![0].mask);
  });
});

describe('groupLayers / ungroup', () => {
  it('lands the group in the topmost member’s slot', () => {
    // A is index 1 of [bg, A, grp, D]; the group takes that slot.
    expect(ids(groupLayers(tree(), ['A'], G('NG', [])))).toBe('background,NG,grp,D');
    expect(ids(groupLayers(tree(), ['D'], G('NG', [])))).toBe('background,A,grp,NG');
    // Grouping A (1) and D (3): the group takes D's slot, shifted down by the one member below it.
    expect(ids(groupLayers(tree(), ['A', 'D'], G('NG', [])))).toBe('background,grp,NG');
  });

  it('keeps stacking order, not selection order', () => {
    const r = groupLayers(tree(), ['D', 'A'], G('NG', []));
    expect(ids(findLayer(r, 'NG')!.children!)).toBe('A,D');
  });

  it('refuses a selection spanning parents', () => {
    expect(ids(groupLayers(tree(), ['A', 'B'], G('NG', [])))).toBe('background,A,grp,D');
  });

  it('refuses the background', () => {
    expect(ids(groupLayers(tree(), ['background'], G('NG', [])))).toBe('background,A,grp,D');
  });

  it('splices children back into the group’s slot', () => {
    expect(ids(ungroup(tree(), 'grp'))).toBe('background,A,B,C,D');
    const nested = [BG, G('outer', [L('X'), G('inner', [L('B'), L('C')])])];
    expect(ids(findLayer(ungroup(nested, 'inner'), 'outer')!.children!)).toBe('X,B,C');
  });

  it('refuses a non-group', () => {
    expect(ids(ungroup(tree(), 'A'))).toBe('background,A,grp,D');
  });
});

describe('partitionAdjustments', () => {
  const A = (id: string): StudioLayer => ({ ...L(id), type: 'adjustment' });
  /** Renders the tree as `adj(child, child)` so nesting is readable in a failure message. */
  const shape = (nodes: ReturnType<typeof partitionAdjustments<StudioLayer>>): string =>
    nodes.map((n) => (n.kind === 'layer' ? n.layer.id : `${n.layer.id}(${shape(n.children)})`)).join(',');

  it('leaves a list with no adjustments alone', () => {
    expect(shape(partitionAdjustments([L('a'), L('b')]))).toBe('a,b');
  });

  it('wraps everything below an adjustment', () => {
    expect(shape(partitionAdjustments([L('a'), L('b'), A('adj')]))).toBe('adj(a,b)');
  });

  it('leaves layers above an adjustment outside it', () => {
    expect(shape(partitionAdjustments([L('a'), A('adj'), L('b')]))).toBe('adj(a),b');
  });

  it('nests stacked adjustments inside-out', () => {
    // adj2 must enclose adj1's result *and* c — that is what "everything below" means.
    expect(shape(partitionAdjustments([L('a'), L('b'), A('adj1'), L('c'), A('adj2')])))
      .toBe('adj2(adj1(a,b),c)');
  });

  it('handles an adjustment at the bottom with nothing beneath it', () => {
    expect(shape(partitionAdjustments([A('adj'), L('a')]))).toBe('adj(),a');
  });

  it('encloses the background, so a root adjustment reaches the page', () => {
    expect(shape(partitionAdjustments([BG, A('adj')]))).toBe('adj(background)');
  });
});

describe('groupClipRuns', () => {
  const C = (id: string): StudioLayer => L(id, { clipped: true });
  const shape = (runs: ReturnType<typeof groupClipRuns<StudioLayer>>): string =>
    runs.map((r) => (r.followers.length ? `${r.base.id}[${r.followers.map((f) => f.id).join(',')}]` : r.base.id)).join(',');

  it('leaves unclipped layers as their own runs', () => {
    expect(shape(groupClipRuns([L('a'), L('b')]))).toBe('a,b');
  });

  it('attaches clipped layers to the nearest base below', () => {
    expect(shape(groupClipRuns([L('a'), C('b'), C('c'), L('d')]))).toBe('a[b,c],d');
  });

  it('starts a new run at each unclipped layer', () => {
    expect(shape(groupClipRuns([L('a'), C('b'), L('c'), C('d')]))).toBe('a[b],c[d]');
  });

  it('renders a clipped layer with nothing beneath it as its own base', () => {
    // Photoshop does the same — a clip with no base to ride on just draws normally.
    expect(shape(groupClipRuns([C('a'), L('b')]))).toBe('a,b');
  });

  it('refuses a base that cannot be one, and does not chain onto the refused layer', () => {
    // Only raster layers can be clip bases. With a text base, *both* clipped layers must fall back
    // to rendering normally — the second must not quietly clip to the first.
    const text: StudioLayer = { ...L('t'), type: 'text' };
    expect(shape(groupClipRuns([text, C('a'), C('b')]))).toBe('t,a,b');
  });

  it('rides several clipped layers on the same base', () => {
    expect(shape(groupClipRuns([L('base'), C('a'), C('b')]))).toBe('base[a,b]');
  });
});

describe('v4 compatibility — flat saves must behave exactly as before', () => {
  const flat = () => [BG, L('A'), L('B')];

  it('walks a flat array identically to the flat code it replaced', () => {
    expect(ids(flattenTree(flat()))).toBe(ids(flat()));
    expect(mapTree(flat(), (l) => l)).toEqual(flat());
  });

  it('updates and removes identically', () => {
    expect(findLayer(updateLayer(flat(), 'A', (l) => ({ ...l, opacity: 0.5 })), 'A')!.opacity).toBe(0.5);
    expect(ids(removeLayers(flat(), ['A']))).toBe('background,B');
  });

  it('reorders identically', () => {
    expect(ids(moveWithinParent(flat(), 'A', 'up'))).toBe('background,B,A');
  });
});
