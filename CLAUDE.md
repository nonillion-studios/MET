# CLAUDE.md — MET (Manga Editing Tool)

Architecture guide for future Claude sessions working on this repo. Read this before touching `src/components/studio/`.

## What this is

**MET** is a React 19 + TypeScript + Vite + Konva web app for manga/manhwa cleaning, translation, and typesetting. It is a normal bundled SPA (not the single-file/offline architecture described in the orphaned prototype doc at `src/assets/claude.md` — that file documents a *different*, disconnected reference prototype at `src/assets/mangastudio (1).html`; useful as design reference only, not part of the shipping app).

Entry point: `src/App.tsx`, rendered via `src/main.tsx` into `index.html`. Top-level navigation (`src/config/navTabs.ts`) currently has 4 tabs: Library, Cloud, Teams, Settings — there is no dedicated Home/landing screen yet (see "Known gaps" below).

## Data model

`src/types.ts` defines the persisted hierarchy:

```
Workspace { mangas: MangaSeries[] }
  MangaSeries { volumes: Volume[] }
    Volume { chapters: Chapter[] }
      Chapter { pages: Page[] }
        Page { original: ProcessedImage, cleaned: ProcessedImage | null }
```

`workspaces: Workspace[]` lives in `App.tsx` state, autosaved to IndexedDB (`idb-keyval`, key `workspaces_library`) debounced 800ms (`App.tsx`). Schema evolution goes through `src/lib/migrate.ts`'s `migrateWorkspace()`, run once on load.

Original/cleaned pairing: `src/lib/pages.ts`'s `suggestPairing()` — three passes: exact normalized-filename match, then numeric-page-number match (extracts the trailing digit run from each filename), then positional fallback for whatever's left. Always returns an editable suggestion (`PairingSuggestion`), never a silent final assignment — `PageManager.tsx` surfaces unmatched images as a manual drag-to-pair pool.

## The Studio (`src/components/studio/`)

`Studio.tsx` is the main shell, wrapped in three context providers (`ColorProvider`, `HistoryProvider`, `DockProvider`). Mounted only when a chapter is opened (`App.tsx`, `chapterView === 'studio'`); fully unmounts when navigating back to the page manager or a different chapter, so per-chapter state doesn't need explicit reset logic — a fresh mount is a fresh chapter.

### Per-page layer stack

`layersByPage: Record<pageId, StudioLayer[]>` in `Studio.tsx` — every page always has a locked `Background` layer. `StudioLayer` (`studioTypes.ts`) covers `background | clean-patch | text | bubble-mask | adjustment` types; only `clean-patch` (raster) and `text` are actually implemented — `bubble-mask` and `adjustment` are declared in the type union but have zero implementation anywhere (no create path, no rendering). This is a real, documented gap, not a stub to build against blindly.

Raster pixel content for `clean-patch` layers lives **only** as live `HTMLCanvasElement`s in `paint/paintCanvasRegistry.ts`, held in a `useRef` inside `StudioCanvas.tsx` — never in React state directly. This registry persists across page switches within a session (keyed by layer id, not page id), which is what lets `StudioCanvas.getExportSnapshot()`/`exportRasterLayers()` capture edits made on any page visited so far, not just the currently active one.

Real, working layer features: opacity, blend mode (`globalCompositeOperation` via `BLEND_TO_COMPOSITE`), visibility, lock, reorder, duplicate, delete. **Not implemented**: layer groups, masks, adjustment layers (non-destructive filters), smart objects — each would be a substantial separate feature (groups/masks especially would require moving off a flat `StudioLayer[]` array to a tree).

### Canvas engine (`StudioCanvas.tsx`)

Konva `Stage`/`Layer` per page. Background image loads into `image` state from `page.original` or `page.cleaned` (via `showCleaned`); when `overlayOpacity > 0` and `showCleaned` is true, `page.original` also loads as a second `overlayImage` rendered on top at that opacity (View Original overlay mode).

Pan: Pan/Select tools drag the Stage natively; **any other tool** pans via Space-hold or middle-mouse-drag, handled manually through `panRef` + window-level `mousemove`/`mouseup` listeners (not Konva's built-in drag, to avoid fighting per-tool pointer handlers). Two-finger touch pans *and* pinch-zooms simultaneously (`handleTouchMove` anchors on the *previous* frame's pinch center, not the current one — a plain two-finger drag with no distance change still pans correctly).

Tool routing in `handlePaintPointerDown/Move/Up` dispatches by `activeTool` string against several disjoint sets: `MARQUEE_TOOLS`, `LASSO_TOOLS` (drag-based freehand only — `lasso-polygon` is click-accumulate, handled separately via `handleStageClick`/`lassoPolyPoints`, mirroring the Pen tool's `penPoints` pattern), `PAINT_TOOLS` (from `paint/usePaintLayer.ts`). Marquee Shift constrains to a perfect square/circle.

Selection model: `paint/selection.ts`'s `Selection` union (`rect | ellipse | polygon | mask`) — vector shapes clip via `Path2D`, magic-wand masks approximate live via bounding box during a stroke and get pixel-perfect refinement on commit (`refineMaskedRegion`). **Not implemented**: feather, expand/contract, add/subtract with Shift/Alt (would need `Selection` to support compound multi-region masks, not just one shape at a time — real work, not done).

### Persistence

Two separate IndexedDB stores, deliberately kept apart so painting never triggers a full-library rewrite:

- `workspaces_library` (existing, `App.tsx`) — chapter/page structure + image data URLs.
- `studio_<chapterId>` (`src/lib/studioProjectStore.ts`) — layers (with raster pixels as data URLs), TypeR script/styles. Autosaved 1.2s after the last layer/TypeR change *or* committed paint stroke (`Studio.tsx`'s `scheduleAutosave`/`flushAutosave`). Loaded on mount; raster layers hydrate lazily as each page is visited (`loadRasterLayer` polls briefly for the background image to finish loading — see `waitForImage` in `StudioCanvas.tsx`).
- `studio_versions_<chapterId>` — capped (10) full-copy version snapshots pushed on every autosave. No diffing/compaction; fine at this scale, revisit only if real usage shows storage bloat.

Native project format: `.msp` (zipped JSON containing the full workspace tree + every chapter's studio data), `src/lib/mspFile.ts`. Export/import UI lives in `App.tsx`'s workspace list (not inside Studio, since it operates on a whole workspace).

### Export (`src/lib/exportImage.ts`, `src/lib/exportPsd.ts`)

- PNG/JPG/WEBP: `StudioCanvasHandle.getExportSnapshot()` captures background + full layer stack (raster layers as data URLs, text layers as structured data) for the active page; `compositeFlattenedImage()` flattens onto a canvas respecting opacity/blend/visibility, rendering text layers via canvas 2D (`fillText`/`strokeText`, with manual greedy word-wrap to approximate Konva's auto-wrap). JPG flattens onto white first (no alpha channel).
- PSD: `exportPsd()` builds an `ag-psd` `Psd` object — one layer per `StudioLayer`, raster layers get a canvas, text layers get `LayerTextData` (editable in Photoshop; font family names pass through as-is, Photoshop substitutes if not installed — can't resolve that from a browser). `ag-psd` is **dynamically imported** (`await import('ag-psd')`) so it code-splits into its own chunk instead of bloating the main bundle (it's ~300KB alone).
- `ExportDialog.tsx` wires both into the Project menu / `Ctrl/Cmd+E`.

Text export (TXT/DOCX/PDF) does not exist yet — there is no text editor to export from (see Phase 7 gap below).

### TypeR (scripted lettering)

`studioTypes.ts`'s `parseTyperScript()` + `TyperPanel.tsx`. Paste a script, arm it, click bubbles to stamp lines in order with per-line styles matched by prefix (longest prefix wins; empty-prefix style is the catch-all).

Ported from the real TypeR 2.5 extension's documented behavior (see `src/assets/claude.md` for the original algorithm description, and `src/assets/mangastudio (1).html` for a working reference implementation):
- `##`-prefixed lines are ignored (notes).
- `//`-prefixed lines continue (append to) the previously placed line rather than starting a new one.
- `Page N` control lines (English or Arabic, incl. Arabic-Indic digits) tag the next real line with a page hint; `Studio.tsx` auto-switches pages as the armed script advances onto a hinted line (matches by number extracted from the target page's filename, falling back to 1-based position).
- A line fully wrapped in `**bold**`/`<b>...</b>` or `*italic*`/`<i>...</i>` overrides that style's weight for just that placement.
- Styles have an optional `folder` field for organizing the panel into collapsible groups — **folder does not affect prefix-matching priority** (simplified from the original "focused folder" UI concept, which doesn't exist here); matching is purely longest-prefix-first across all styles.

**Not implemented**: Multi-Bubble mode (accumulating several marquee selections and filling them in sequence from consecutive script lines) and true per-character rich text (bold/italic overrides apply to the whole placed layer, since `TextLayerData` has no per-run styling — would need either rich HTML content or a run-based text model, a bigger change than this pass covers).

### Translation Preview panel

`TranslationPreviewPanel.tsx` — lists every text layer across every page in the chapter (reads `layersByPage` directly, no extra loading needed since it's already all in memory), with jump-to-bubble, cross-page search/replace, and per-dialogue status (`draft/translated/reviewed`) + comment fields on `TextLayerData`. Cross-page edits go through `Studio.tsx`'s `updateLayersOnPage()` (a generalization of the original active-page-only `updateLayers()`).

### Dock/panel system (`dock/`)

`DockContext.tsx` manages which tab is active in the `top`/`bottom` regions and which tabs are floating (`FloatingPanel.tsx`, drag + resize). Layout (active tabs + floating rects) persists to `localStorage` under `dock_layout_<chapterId>`, debounced — scoped per chapter so switching projects doesn't bleed one chapter's panel arrangement into another's. `homeRegion` (which region a tab defaults to) is static (`dockLayout.ts`'s `DEFAULT_DOCK_REGION`) and never mutated at runtime, so it isn't persisted.

Responsive breakpoints (`Studio.tsx`'s `layoutMode`): `desktop` (≥1024px, side dock), `tablet` (768–1024px, dock collapses to a tap-to-open icon strip overlay), `phone` (<768px, bottom sheet — **not yet redesigned** per the fuller phone spec of a bottom toolbar + full-height slide-in sheets; still using the original 45vh bottom-sheet dock).

Fullscreen: native Fullscreen API on the Studio root, synced to `fullscreenchange` (not just button state, so Esc/browser UI stays in sync). Not bound to literal F11 — browsers intercept that key at the chrome level before JS reliably sees it — bound to `Ctrl/Cmd+Shift+F` instead. `Tab` hides all panels (menu bar, tool options, tool rail, dock, floating panels), guarded against firing while any input/textarea/contenteditable has focus.

Window menu items render real checkmarks (`Menu.tsx`'s `checked` field) reflecting actual panel/fullscreen/hidden state — not decorative.

### Workflow bar

`WorkflowBar.tsx` — a slim stage-pill strip (Chapter → Page → Detection → Cleaning → Drawing → Typesetting → Review → Export) mounted between the toolbar and tool options bar. Every "active" pill reflects a real, checkable condition (has a cleaned page, has a `clean-patch` layer, has a non-empty text layer); Detection/Review/Export are shown dim/untracked since nothing in the app tracks those stages yet — deliberately not faked.

## Known gaps (honest, not silently dropped)

- **No standalone text editor.** Nothing Word-like exists — no pagination, spell-checker, DOCX/PDF/TXT export, or "send editor text → TypeR" pipeline. This is real, substantial net-new work (a full second app page), not a bug fix.
- **No Home/landing page.** Top nav is 4 flat tabs (Library/Cloud/Teams/Settings); Recent/Templates/Tutorials/Plugins/Account don't exist. Building nav destinations with no real content behind them would violate the no-placeholder rule — needs real features first.
- **Touch/pointer engine is only partially unified.** Brush/paint tools still use separate mouse (`onMouseDown` et al.) and touch (`onTouchMove` et al.) handlers rather than a single Pointer Events pipeline; stylus pressure (`PointerEvent.pressure`) is not read anywhere. Two-finger pan/pinch and press-and-hold flyouts do work on touch already.
- **Interactive control sizing** on mobile/tablet breakpoints hasn't had a systematic ≥44px touch-target pass — many buttons/sliders are still 24–32px.
- **Layer groups/masks/adjustment layers/smart objects**, **magnetic lasso**, **patch tool**, **curvature pen / path selection / direct selection**, **selection feather/expand/contract/add-subtract**, **liquify**, **brush mirror/symmetry modes** — declared as intended features (in tool lists or type unions) but not implemented. Each is a genuinely separate chunk of work.
- **Fonts manager, music player, navigator/minimap, rulers/grid/guides** — not implemented.

## Conventions

- Keep the two IndexedDB stores (`workspaces_library` vs `studio_<chapterId>`) separate — don't fold raster/layer data into the main library object; that was a deliberate autosave-cost decision.
- New persisted shapes should include a `schemaVersion` field and a real migration path (see `migrate.ts` for the pattern), not just hope old data happens to still parse.
- Large/optional dependencies (like `ag-psd`) should be dynamically imported, not top-level, to keep the main bundle lean — check `npm run build`'s chunk output after adding one.
- `npm run lint` is actually `tsc --noEmit` (no separate linter configured) — run it after any change; `npm run build` is the stronger check since Vite/Rollup catch a few things `tsc --noEmit` alone doesn't.
