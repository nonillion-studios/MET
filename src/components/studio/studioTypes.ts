import type { LucideIcon } from 'lucide-react';
import { Image as ImageIcon, Type, Eraser, MessageSquare, SlidersHorizontal } from 'lucide-react';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
];

/** Maps our blend mode ids to Konva's globalCompositeOperation values. */
export const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};

export type StudioLayerType = 'background' | 'clean-patch' | 'text' | 'bubble-mask' | 'adjustment';

export const LAYER_TYPE_ICON: Record<StudioLayerType, LucideIcon> = {
  background: ImageIcon,
  'clean-patch': Eraser,
  text: Type,
  'bubble-mask': MessageSquare,
  adjustment: SlidersHorizontal,
};

export interface StudioLayer {
  id: string;
  type: StudioLayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  /** Background layers can't be deleted, reordered below, or have opacity/blend changed. */
  isBackground?: boolean;
}

export function createBackgroundLayer(): StudioLayer {
  return {
    id: 'background',
    type: 'background',
    name: 'Background',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    isBackground: true,
  };
}

let layerCounter = 0;
export function createLayer(type: StudioLayerType, name: string): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
  };
}
