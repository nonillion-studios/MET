export type DockRegionId = 'top' | 'bottom';

/** Where each dock tab lives by default; user float/dock-back actions only change this at runtime, in memory. */
export const DEFAULT_DOCK_REGION: Record<string, DockRegionId> = {
  text: 'top',
  layers: 'top',
  typer: 'bottom',
  color: 'bottom',
  history: 'bottom',
  pages: 'bottom',
};

export const DOCK_PANEL_GROUP_AUTOSAVE_ID = 'met-studio-dock-panels-v1';
