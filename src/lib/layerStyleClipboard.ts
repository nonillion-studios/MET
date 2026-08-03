import type { LayerEffects } from '../components/studio/studioTypes';

/**
 * A module-level (not React state) clipboard for the Layers panel's Copy/Paste/Clear Layer Style
 * context-menu actions — mirrors `layerClipboard.ts`'s own reasoning: living outside any component
 * means it survives whatever re-renders happen between a Copy and a later Paste on a different
 * layer. Always a plain data clone (the effects object a layer style patch is built from is never
 * mutated in place elsewhere in this codebase), never a reference into the live layer tree.
 */
let clipboardEffects: LayerEffects | null = null;

export function getClipboardLayerStyle(): LayerEffects | null {
  return clipboardEffects;
}

export function setClipboardLayerStyle(effects: LayerEffects | null): void {
  clipboardEffects = effects;
}
