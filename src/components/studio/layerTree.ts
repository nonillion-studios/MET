import type { StudioLayer, StudioLayerType } from './studioTypes';

/**
 * Owns the layer-tree invariant, the same role `textRuns.ts` plays for text runs: nothing outside
 * this module may walk or edit `StudioLayer.children` by hand. `Studio.tsx`'s `updateLayersOnPage`
 * stays the only mutation primitive; every updater handed to it is composed from the writers here.
 *
 * Two invariants, enforced by every writer below:
 *
 *  1. **The background is root index 0, always.** It can't be removed, reparented, moved, or have
 *     anything placed beneath it.
 *  2. **`children` is present iff `type === 'group'`.** Non-groups never carry it, which is what
 *     lets every recursion here bottom out immediately on pre-group (v4) data.
 *
 * Illegal operations — cycles, moving the background, reparenting into a non-group — **return the
 * input unchanged** rather than throwing. The Layers panel computes drop intent from mouse
 * geometry; a bad drag must degrade to nothing happening, never to a corrupted tree.
 *
 * Every writer is pure and returns a new root array.
 */

/** Index path from the root array: `[2]` is root index 2, `[2, 0]` its first child. */
export type LayerPath = number[];

export interface LayerEntry {
  layer: StudioLayer;
  path: LayerPath;
  depth: number;
}

/**
 * The shape the structural walkers need. Generic over it so `SerializedStudioLayer` — same tree,
 * plus pixel data URLs — can reuse `flattenTree`/`mapTree` instead of growing a parallel walker
 * that could drift from this one.
 */
export interface LayerTreeNode {
  type: StudioLayerType;
  children?: LayerTreeNode[];
}

const childrenOf = <T extends LayerTreeNode>(layer: T): T[] =>
  (layer.type === 'group' ? (layer.children as T[] | undefined) ?? [] : []);

// ---------------------------------------------------------------- read

/**
 * Depth-first, bottom-to-top, each group *after* its own children — i.e. paint order, which is
 * what both the Konva render walk and the PSD writer want.
 */
export function flattenTree<T extends LayerTreeNode>(layers: T[]): T[] {
  const out: T[] = [];
  const walk = (list: T[]) => {
    for (const layer of list) {
      walk(childrenOf(layer));
      out.push(layer);
    }
  };
  walk(layers);
  return out;
}

/** Same order as `flattenTree`, carrying path and depth. Drives the panel's indent. */
export function flattenWithPaths(layers: StudioLayer[]): LayerEntry[] {
  const out: LayerEntry[] = [];
  const walk = (list: StudioLayer[], prefix: LayerPath, depth: number) => {
    list.forEach((layer, i) => {
      const path = [...prefix, i];
      walk(childrenOf(layer), path, depth + 1);
      out.push({ layer, path, depth });
    });
  };
  walk(layers, [], 0);
  return out;
}

export function buildIndex(layers: StudioLayer[]): Map<string, LayerEntry> {
  const index = new Map<string, LayerEntry>();
  for (const entry of flattenWithPaths(layers)) index.set(entry.layer.id, entry);
  return index;
}

export function findLayer(layers: StudioLayer[], id: string): StudioLayer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    const hit = findLayer(childrenOf(layer), id);
    if (hit) return hit;
  }
  return null;
}

export function findPath(layers: StudioLayer[], id: string): LayerPath | null {
  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i].id === id) return [i];
    const sub = findPath(childrenOf(layers[i]), id);
    if (sub) return [i, ...sub];
  }
  return null;
}

export function getAtPath(layers: StudioLayer[], path: LayerPath): StudioLayer | null {
  let list = layers;
  let found: StudioLayer | null = null;
  for (const i of path) {
    found = list[i] ?? null;
    if (!found) return null;
    list = childrenOf(found);
  }
  return found;
}

/** The layer's parent group, or null when it sits at the root. */
export function getParent(layers: StudioLayer[], id: string): StudioLayer | null {
  const path = findPath(layers, id);
  if (!path || path.length < 2) return null;
  return getAtPath(layers, path.slice(0, -1));
}

export function getSiblings(layers: StudioLayer[], id: string): StudioLayer[] {
  const parent = getParent(layers, id);
  return parent ? childrenOf(parent) : layers;
}

/** The layer plus every descendant. Delete uses it for registry cleanup; duplicate for id regen. */
export function collectSubtree(layer: StudioLayer): StudioLayer[] {
  const out: StudioLayer[] = [layer];
  for (const child of childrenOf(layer)) out.push(...collectSubtree(child));
  return out;
}

export function isDescendantOf(layers: StudioLayer[], maybeChildId: string, ancestorId: string): boolean {
  const ancestor = findLayer(layers, ancestorId);
  if (!ancestor) return false;
  return collectSubtree(ancestor).some((l) => l.id === maybeChildId && l.id !== ancestorId);
}

const ancestorChain = (layers: StudioLayer[], id: string): StudioLayer[] => {
  const path = findPath(layers, id);
  if (!path) return [];
  const chain: StudioLayer[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const ancestor = getAtPath(layers, path.slice(0, i));
    if (ancestor) chain.push(ancestor);
  }
  return chain;
};

/**
 * Visibility as the canvas sees it: false if the layer *or any ancestor group* is hidden.
 * Konva has no inheritance for this, so hit-testing and rendering both have to ask.
 */
export function isEffectivelyVisible(layers: StudioLayer[], id: string): boolean {
  const layer = findLayer(layers, id);
  if (!layer || !layer.visible) return false;
  return ancestorChain(layers, id).every((a) => a.visible);
}

export function isEffectivelyLocked(layers: StudioLayer[], id: string): boolean {
  const layer = findLayer(layers, id);
  if (!layer) return false;
  if (layer.locked) return true;
  return ancestorChain(layers, id).some((a) => a.locked);
}

/** Whether the up/down buttons should be live — mirrors what `moveWithinParent` will accept. */
export function canMove(layers: StudioLayer[], id: string, dir: 'up' | 'down'): boolean {
  const layer = findLayer(layers, id);
  if (!layer || layer.isBackground) return false;
  const siblings = getSiblings(layers, id);
  const i = siblings.findIndex((l) => l.id === id);
  if (i < 0) return false;
  const target = dir === 'up' ? i + 1 : i - 1;
  if (target < 0 || target >= siblings.length) return false;
  return !siblings[target].isBackground;
}

// ---------------------------------------------------------------- write

export function mapTree<T extends LayerTreeNode>(layers: T[], fn: (l: T) => T): T[] {
  return layers.map((layer) => {
    const mapped = fn(layer);
    if (mapped.type !== 'group' || !mapped.children) return mapped;
    return { ...mapped, children: mapTree(mapped.children as T[], fn) };
  });
}

export function updateLayer(
  layers: StudioLayer[],
  id: string,
  patch: (l: StudioLayer) => StudioLayer,
): StudioLayer[] {
  return mapTree(layers, (l) => (l.id === id ? patch(l) : l));
}

/** Removes each id *and its whole subtree*. Never removes the background. */
export function removeLayers(layers: StudioLayer[], ids: string[]): StudioLayer[] {
  const doomed = new Set(ids);
  const prune = (list: StudioLayer[]): StudioLayer[] =>
    list
      .filter((l) => !doomed.has(l.id) || l.isBackground)
      .map((l) => (l.type === 'group' && l.children ? { ...l, children: prune(l.children) } : l));
  return prune(layers);
}

/** Inserts directly above `siblingId`, into whatever parent that sibling lives in. */
export function insertAfter(layers: StudioLayer[], siblingId: string, incoming: StudioLayer): StudioLayer[] {
  const path = findPath(layers, siblingId);
  if (!path) return [...layers, incoming];
  const parentId = path.length > 1 ? getAtPath(layers, path.slice(0, -1))?.id ?? null : null;
  return insertInto(layers, parentId, path[path.length - 1] + 1, incoming);
}

/** Inserts at `index` within `parentId` (null = root). Refuses index 0 at the root — that's the background. */
export function insertInto(
  layers: StudioLayer[],
  parentId: string | null,
  index: number,
  incoming: StudioLayer,
): StudioLayer[] {
  if (parentId === null) {
    const at = Math.max(1, Math.min(index, layers.length));
    const next = [...layers];
    next.splice(at, 0, incoming);
    return next;
  }
  const parent = findLayer(layers, parentId);
  if (!parent || parent.type !== 'group') return layers;
  return updateLayer(layers, parentId, (g) => {
    const children = [...(g.children ?? [])];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, incoming);
    return { ...g, children };
  });
}

/** Swaps with the adjacent sibling — the panel's up/down buttons. Stays within the current parent. */
export function moveWithinParent(layers: StudioLayer[], id: string, dir: 'up' | 'down'): StudioLayer[] {
  if (!canMove(layers, id, dir)) return layers;
  const path = findPath(layers, id);
  if (!path) return layers;
  const i = path[path.length - 1];
  const target = dir === 'up' ? i + 1 : i - 1;

  const swap = (list: StudioLayer[]): StudioLayer[] => {
    const next = [...list];
    [next[i], next[target]] = [next[target], next[i]];
    return next;
  };

  if (path.length === 1) return swap(layers);
  const parent = getAtPath(layers, path.slice(0, -1));
  if (!parent) return layers;
  return updateLayer(layers, parent.id, (g) => ({ ...g, children: swap(g.children ?? []) }));
}

/**
 * Drag-and-drop reparent. Refuses the three ways this corrupts a tree: moving a layer into its own
 * subtree (a cycle), moving the background, and targeting a parent that isn't a group.
 */
export function reparent(
  layers: StudioLayer[],
  id: string,
  newParentId: string | null,
  index: number,
): StudioLayer[] {
  const layer = findLayer(layers, id);
  if (!layer || layer.isBackground) return layers;
  if (newParentId === id) return layers;
  if (newParentId && isDescendantOf(layers, newParentId, id)) return layers;
  if (newParentId) {
    const parent = findLayer(layers, newParentId);
    if (!parent || parent.type !== 'group') return layers;
  }

  // Detach first, then insert — so `index` is read against the list the layer is landing in,
  // post-removal. Computing both against the pre-move tree is the classic off-by-one here.
  const detached = removeLayers(layers, [id]);
  return insertInto(detached, newParentId, index, layer);
}

let cloneCounter = 0;
/**
 * Deep-clones a subtree with fresh ids throughout, returning the copy and an old→new id map.
 *
 * The map is not a convenience: `paintCanvasRegistry` and `maskCanvasRegistry` are keyed by layer
 * id, so a caller that doesn't clone each descendant's canvas under its new id gets a layer whose
 * pixels are silently blank. (That was a real bug in `handleDuplicateLayer` before this existed.)
 */
export function cloneSubtree(
  layer: StudioLayer,
  nameSuffix = ' copy',
): { copy: StudioLayer; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const clone = (src: StudioLayer, isRoot: boolean): StudioLayer => {
    cloneCounter += 1;
    const id = `layer-${Date.now()}-c${cloneCounter}`;
    idMap.set(src.id, id);
    const copy: StudioLayer = {
      ...structuredClone(src),
      id,
      name: isRoot ? `${src.name}${nameSuffix}` : src.name,
    };
    if (copy.mask) {
      cloneCounter += 1;
      const maskId = `mask-${Date.now()}-c${cloneCounter}`;
      idMap.set(src.mask!.id, maskId);
      copy.mask = { ...copy.mask, id: maskId };
    }
    if (src.type === 'group' && src.children) copy.children = src.children.map((c) => clone(c, false));
    return copy;
  };
  return { copy: clone(layer, true), idMap };
}

/**
 * Wraps `ids` in `group`, placed where the topmost member was.
 *
 * Refuses a selection that spans parents. Photoshop reparents them all into the new group; doing
 * that silently reorders layers relative to siblings the user didn't select, so this refuses and
 * lets the panel disable the command instead.
 */
export function groupLayers(layers: StudioLayer[], ids: string[], group: StudioLayer): StudioLayer[] {
  const members = ids
    .map((id) => findLayer(layers, id))
    .filter((l): l is StudioLayer => !!l && !l.isBackground);
  if (members.length === 0) return layers;

  const parentIds = new Set(members.map((m) => getParent(layers, m.id)?.id ?? null));
  if (parentIds.size > 1) return layers;

  const parentId = [...parentIds][0] ?? null;
  const siblings = parentId ? childrenOf(findLayer(layers, parentId)!) : layers;
  const indices = members.map((m) => siblings.findIndex((s) => s.id === m.id)).filter((i) => i >= 0);
  if (indices.length === 0) return layers;
  const topIndex = Math.max(...indices);

  // Keep the members in their existing stacking order rather than selection order.
  const ordered = siblings.filter((s) => members.some((m) => m.id === s.id));
  const detached = removeLayers(layers, members.map((m) => m.id));

  // The group takes the topmost member's slot; every member removed *below* that slot shifts it down.
  const removedBelow = indices.filter((i) => i < topIndex).length;
  const insertAt = topIndex - removedBelow;
  return insertInto(detached, parentId, insertAt, { ...group, type: 'group', children: ordered });
}

/** A layer to draw as-is, or an adjustment wrapping everything below it. */
export type RenderNode<T> =
  | { kind: 'layer'; layer: T }
  | { kind: 'adjustment'; layer: T; children: RenderNode<T>[] };

/**
 * Rewrites a sibling list so each adjustment *encloses everything below it in that list*.
 *
 *   [A, B, adj1, C, adj2]  ->  [ adj2( adj1(A, B), C ) ]
 *
 * Read inside-out: `adj1` wraps A and B; `adj2` wraps that result plus C. Rendering each wrapper as
 * a cached node with the adjustment's filter is then exactly "affects everything below in the
 * stack", nested correctly and for free — which a flat "filter the background" pass can never be,
 * because it ignores where the adjustment actually sits.
 *
 * Both renderers walk this: the canvas builds Konva Groups from it, the exporter composites it.
 * Scope note: an adjustment inside a group reaches only its own siblings, never out of the group.
 * That's Photoshop's behaviour for a non-clipped adjustment in a group, and it falls out for free.
 *
 * Generic over the node type so `SerializedStudioLayer` (export) and `StudioLayer` (canvas) share it.
 */
export function partitionAdjustments<T extends { type: StudioLayerType }>(list: T[]): RenderNode<T>[] {
  let acc: RenderNode<T>[] = [];
  for (const layer of list) {
    if (layer.type === 'adjustment') acc = [{ kind: 'adjustment', layer, children: acc }];
    else acc.push({ kind: 'layer', layer });
  }
  return acc;
}

/** A base layer plus the clipped layers riding on it. `followers` is empty for an unclipped layer. */
export interface ClipRun<T> {
  base: T;
  followers: T[];
}

/**
 * Whether a layer can act as a clipping base.
 *
 * Only raster layers, deliberately. Both renderers trim a run by re-drawing the base with
 * `destination-in`, which is only well-behaved when the base is a *single* drawable: an uncached
 * Konva Group applies the composite op per child, so re-drawing a text base would hit its
 * transparent hit-rect first and wipe the run instead of trimming it to the glyphs. A group base
 * has the same problem, and the background is fully opaque so clipping to it would do nothing.
 *
 * This is an honest subset, not an oversight — clipping shading to a cleaned patch is the manga
 * case. `LayersPanel` disables the command when the layer below can't be a base.
 */
export function canBeClipBase<T extends { type: StudioLayerType }>(layer: T | null | undefined): boolean {
  return layer?.type === 'clean-patch';
}

/**
 * Groups a sibling list into clip runs: each non-clipped layer, plus the clipped layers directly
 * above it that ride on its alpha.
 *
 * A clipped layer at the bottom of a list has no base to clip to. Photoshop simply renders it
 * normally in that case, and so do we — it comes back as its own run with no followers.
 *
 * Both renderers walk this, and both draw a run as `[base, ...followers, base again with
 * destination-in]`: re-drawing the base last trims the followers to its alpha. The obvious
 * alternative — `source-atop` on each follower — would occupy the follower's own
 * `globalCompositeOperation` slot, and a *clipped Multiply layer* is the standard manga shading
 * idiom, so it has to keep its own blend mode.
 */
export function groupClipRuns<T extends { clipped?: boolean; type: StudioLayerType }>(list: T[]): ClipRun<T>[] {
  const runs: ClipRun<T>[] = [];
  for (const layer of list) {
    const last = runs[runs.length - 1];
    // `!last.base.clipped` matters: consecutive clipped layers all ride the same base. Without it,
    // a clipped layer that failed to attach would become a base for the next one and quietly clip
    // to the wrong thing.
    const attachable = layer.clipped && last && !last.base.clipped && canBeClipBase(last.base);
    if (attachable) last.followers.push(layer);
    else runs.push({ base: layer, followers: [] });
  }
  return runs;
}

/** Dissolves a group, splicing its children back into its own slot in stacking order. */
export function ungroup(layers: StudioLayer[], groupId: string): StudioLayer[] {
  const group = findLayer(layers, groupId);
  if (!group || group.type !== 'group') return layers;
  const path = findPath(layers, groupId);
  if (!path) return layers;

  const children = group.children ?? [];
  const index = path[path.length - 1];
  const splice = (list: StudioLayer[]): StudioLayer[] => {
    const next = [...list];
    next.splice(index, 1, ...children);
    return next;
  };

  if (path.length === 1) return splice(layers);
  const parent = getAtPath(layers, path.slice(0, -1));
  if (!parent) return layers;
  return updateLayer(layers, parent.id, (g) => ({ ...g, children: splice(g.children ?? []) }));
}
