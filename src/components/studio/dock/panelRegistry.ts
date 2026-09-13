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
  /** Panels sharing a `group` render as one `CollapsiblePanel` with an internal tab strip
   *  (`PanelTabGroup`) instead of each getting its own row — only ever applied to panels that
   *  genuinely already exist (no stub/placeholder panels created just to fill out a group). A
   *  group with only one currently-visible member renders as a plain ungrouped panel. */
  group?: string;
}

/** Display label for a `group`, shown as the shared `CollapsiblePanel`'s own header title (the tab
 *  strip inside it already shows each member's own name). */
export const PANEL_GROUP_LABELS: Record<string, string> = {
  ai: 'AI',
};

export const PANEL_REGISTRY: PanelDefinition[] = [
  { id: 'collab', title: 'Live Session', defaultHeight: 260, minHeight: 120, defaultCollapsed: false, defaultVisible: false },
  { id: 'color', title: 'Color', defaultHeight: 240, minHeight: 100, defaultCollapsed: false, defaultVisible: true },
  { id: 'typer', title: 'TypeR', defaultHeight: 320, minHeight: 140, defaultCollapsed: false, defaultVisible: true },
  { id: 'magicerase', title: 'Magic Erase', defaultHeight: 200, minHeight: 100, defaultCollapsed: true, defaultVisible: false, group: 'ai' },
  { id: 'translation', title: 'Translation', defaultHeight: 240, minHeight: 100, defaultCollapsed: true, defaultVisible: true, group: 'ai' },
  { id: 'layers', title: 'Layers', defaultHeight: 300, minHeight: 220, defaultCollapsed: false, defaultVisible: true, grow: true },
  { id: 'brushes', title: 'Brushes', defaultHeight: 260, minHeight: 100, defaultCollapsed: true, defaultVisible: true },
  { id: 'fonts', title: 'Fonts', defaultHeight: 220, minHeight: 100, defaultCollapsed: true, defaultVisible: false },
  // Single context-aware entry replacing the old separate 'text'/'adjustment' registrations — see
  // dock/PropertiesPanel.tsx, which decides what actually renders based on the current selection.
  { id: 'properties', title: 'Properties', defaultHeight: 260, minHeight: 100, defaultCollapsed: false, defaultVisible: false },
  { id: 'history', title: 'History', defaultHeight: 220, minHeight: 100, defaultCollapsed: false, defaultVisible: false },
];

export const PANEL_IDS: string[] = PANEL_REGISTRY.map(p => p.id);
export const PANEL_BY_ID: Map<string, PanelDefinition> = new Map(PANEL_REGISTRY.map(p => [p.id, p]));
