import type { LucideIcon } from 'lucide-react';
import {
  MousePointer2, Hand, Type, Eraser, Wand2, Scissors,
  Paintbrush, Lasso, Square, Pipette, Stamp,
} from 'lucide-react';

export interface StudioTool {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Tools land here as they're implemented; unimplemented ones render disabled with a "coming soon" hint. */
  enabled: boolean;
  /** Starts a new visually-separated group in the rail. */
  groupStart?: boolean;
}

export const STUDIO_TOOLS: StudioTool[] = [
  { id: 'select', label: 'Move', icon: MousePointer2, enabled: true },
  { id: 'pan', label: 'Hand', icon: Hand, enabled: true },

  { id: 'marquee', label: 'Rectangular Select', icon: Square, enabled: false, groupStart: true },
  { id: 'lasso', label: 'Lasso Select', icon: Lasso, enabled: false },
  { id: 'bubble', label: 'Bubble Detect', icon: Wand2, enabled: false },

  { id: 'clean', label: 'Clean Brush', icon: Eraser, enabled: false, groupStart: true },
  { id: 'brush', label: 'Brush', icon: Paintbrush, enabled: false },
  { id: 'stamp', label: 'Clone Stamp', icon: Stamp, enabled: false },
  { id: 'eyedropper', label: 'Eyedropper', icon: Pipette, enabled: false },

  { id: 'text', label: 'Text', icon: Type, enabled: false, groupStart: true },
  { id: 'crop', label: 'Crop', icon: Scissors, enabled: false },
];
