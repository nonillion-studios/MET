/**
 * Single source of truth for every known right-column panel's identity and default sizing.
 * Adding a new panel is "add one entry here" — `PanelLayoutContext` derives its defaults from
 * this array instead of three separate hardcoded objects, and `Studio.tsx` sources panel titles
 * from it too. Panel *content* (the actual React nodes, which need live props like `layers` or
 * `activeLayerId`) still gets wired per-panel in `Studio.tsx` as a `PanelStackEntry` — a static
 * registry can't hold that without an unrelated prop-drilling rewrite, so this table only owns
 * layout/sizing metadata, not rendering.
 */
export interface PanelDefinition {
  id: string;
  title: string;
  /** px, used when the panel isn't collapsed and isn't `grow`. */
  defaultHeight: number;
  /** px, the floor a resize divider can shrink this panel to. */
  minHeight: number;
  defaultCollapsed: boolean;
  defaultVisible: boolean;
  /** Layers only: fills remaining column space via flex instead of a stored height. CLAUDE.md
   *  documents this as deliberate (an existing e2e test drags a layer onto a group and needs
   *  Layers not to be squeezed to nothing by whatever else is expanded above it), so it's excluded
   *  from the height-storage/reset-height model every other panel gets. */
  grow?: boolean;
  /** Panels sharing the same `tabGroup` render as tabs within one collapsible unit.
   *  The first visible panel in a group is the default active tab. */
  tabGroup?: string;
}

export const PANEL_REGISTRY: PanelDefinition[] = [
  { id: 'collab', title: 'Live Session', defaultHeight: 260, minHeight: 120, defaultCollapsed: false, defaultVisible: false },
  { id: 'color', title: 'Color', defaultHeight: 240, minHeight: 100, defaultCollapsed: false, defaultVisible: true },
  { id: 'typer', title: 'TypeR', defaultHeight: 320, minHeight: 140, defaultCollapsed: false, defaultVisible: true, tabGroup: 'text' },
  { id: 'magicerase', title: 'Magic Erase', defaultHeight: 200, minHeight: 100, defaultCollapsed: true, defaultVisible: false, tabGroup: 'ai' },
  { id: 'translation', title: 'Translation', defaultHeight: 240, minHeight: 100, defaultCollapsed: true, defaultVisible: true, tabGroup: 'ai' },
  { id: 'layers', title: 'Layers', defaultHeight: 300, minHeight: 220, defaultCollapsed: false, defaultVisible: true, grow: true, tabGroup: 'layers' },
  { id: 'brushes', title: 'Brushes', defaultHeight: 260, minHeight: 100, defaultCollapsed: true, defaultVisible: true },
  { id: 'fonts', title: 'Fonts', defaultHeight: 220, minHeight: 100, defaultCollapsed: true, defaultVisible: false, tabGroup: 'text' },
  { id: 'adjustment', title: 'Adjustment', defaultHeight: 280, minHeight: 120, defaultCollapsed: true, defaultVisible: false },
  { id: 'text', title: 'Text', defaultHeight: 220, minHeight: 100, defaultCollapsed: false, defaultVisible: false, tabGroup: 'text' },
  { id: 'history', title: 'History', defaultHeight: 220, minHeight: 100, defaultCollapsed: false, defaultVisible: false, tabGroup: 'layers' },
];

export const PANEL_IDS: string[] = PANEL_REGISTRY.map(p => p.id);
export const PANEL_BY_ID: Map<string, PanelDefinition> = new Map(PANEL_REGISTRY.map(p => [p.id, p]));
