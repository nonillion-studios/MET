# CLAUDE.md — MET (Manga Editing Tool)

Architecture guide for future Claude sessions working on this repo. Read this before touching `src/components/studio/`.

## What this is

**MET** is a React 19 + TypeScript + Vite + Konva web app for manga/manhwa cleaning, translation, and typesetting. It is a normal bundled SPA (not the single-file/offline architecture described in the orphaned prototype doc at `src/assets/claude.md` — that file documents a *different*, disconnected reference prototype at `src/assets/mangastudio (1).html`; useful as design reference only, not part of the shipping app).

Entry point: `src/App.tsx`, rendered via `src/main.tsx` into `index.html`. Top-level navigation (`src/config/navTabs.ts`) has 5 tabs: Library, Text Editor, Settings, Teams, Cloud — there is still no dedicated Home/landing screen (Recent/Templates/Tutorials/Plugins/Account), see "Known gaps" below.

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

`layersByPage: Record<pageId, StudioLayer[]>` in `Studio.tsx` — every page always has a locked `Background` layer. `StudioLayer` (`studioTypes.ts`) covers `background | clean-patch | text | bubble-mask | adjustment` types; `clean-patch` (raster), `text`, and `adjustment` are implemented — `bubble-mask` is still declared in the type union with zero implementation anywhere (no create path, no rendering). This is a real, documented gap, not a stub to build against blindly.

Raster pixel content for `clean-patch` layers lives **only** as live `HTMLCanvasElement`s in `paint/paintCanvasRegistry.ts`, held in a `useRef` inside `StudioCanvas.tsx` — never in React state directly. This registry persists across page switches within a session (keyed by layer id, not page id), which is what lets `StudioCanvas.getExportSnapshot()`/`exportRasterLayers()` capture edits made on any page visited so far, not just the currently active one.

Real, working layer features: opacity, blend mode (`globalCompositeOperation` via `BLEND_TO_COMPOSITE`), visibility, lock, reorder, duplicate, delete. **Adjustment layers** (`AdjustmentPanel.tsx`, `src/lib/adjustments.ts`) are real — Brightness/Contrast, Hue/Saturation, and Levels, applied to the background page image only (not to clean-patch/text layers above it) via Konva's own `cache()`/`filters()` pipeline, baked into export snapshots too. **Not implemented**: layer groups, masks, smart objects, and adjustment layers affecting anything other than the background — each would be a substantial separate feature (groups/masks especially would require moving off a flat `StudioLayer[]` array to a tree; a true "affects everything below in the stack" adjustment compositor would need to flatten the whole layer tree per frame).

### Canvas engine (`StudioCanvas.tsx`)

Konva `Stage`/`Layer` per page. Background image loads into `image` state from `page.original` or `page.cleaned` (via `showCleaned`); when `overlayOpacity > 0` and `showCleaned` is true, `page.original` also loads as a second `overlayImage` rendered on top at that opacity (View Original overlay mode).

Pan: Pan/Select tools drag the Stage natively; **any other tool** pans via Space-hold or middle-mouse-drag, handled manually through `panRef` + window-level `mousemove`/`mouseup` listeners (not Konva's built-in drag, to avoid fighting per-tool pointer handlers).

Tool routing in `handlePaintPointerDown/Move/Up` dispatches by `activeTool` string against several disjoint sets: `MARQUEE_TOOLS` (includes `crop`, which reuses the same rect-drag as Rectangular Marquee), `LASSO_TOOLS` (drag-based freehand only — `lasso-polygon` is click-accumulate, handled separately via `handleStageClick`/`lassoPolyPoints`, mirroring the Pen tool's `penPoints` pattern), `PAINT_TOOLS` (from `paint/usePaintLayer.ts`). Marquee Shift constrains to a perfect square/circle; Shift/Alt held at the start of a marquee/lasso/wand drag instead means add/subtract, see Selection model below.

**New clean-patch layers are seeded with a copy of the background** (`Studio.tsx`'s `handleAddLayer` → `StudioCanvas`'s `seedLayerWithBackground`), not left blank — matches the standard manga-cleaning workflow ("duplicate the scan, clean the duplicate") and is what makes Clone/Heal/Blur/Sharpen/Smudge/Dodge/Burn/Sponge/Content-Aware/Liquify actually useful the moment a layer is created, since those tools only ever read/write the active layer's own canvas, never the (immutable, non-paintable) background underneath it. Relatedly, **picking any paint-family tool while a non-`clean-patch` layer is active** (e.g. the default Background layer on a freshly opened chapter) **auto-switches to the topmost existing raster layer, or creates one** (`Studio.tsx`, a `useEffect` keyed on `activeTool`) — without this, every brush/fill/shape/liquify tool would silently no-op on first use, since `getActivePaintCanvas()` only returns a canvas for `clean-patch` layers.

**Magic Wand samples the background composite as a fallback** (`usePaintLayer.ts`'s `getFallbackCanvas`, wired to `StudioCanvas`'s `sampleCanvasRef` — the same hidden canvas the Eyedropper already used) when no clean-patch layer is active, instead of silently operating on a nonexistent/blank raster canvas — otherwise the wand could never select regions of the actual manga art, only whatever happened to be painted on an overlay layer.

**Crop is real** (`StudioCanvas`'s `commitCrop`, triggered by Enter or double-click while the Crop tool is active over a rect selection — mirrors the existing Pen/Polygonal-Lasso "build then Enter/dblclick to commit" convention): trims the background (`page.original` + `page.cleaned`) and every raster layer's canvas to the selection rect, shifts text layers to match, and persists the new page dimensions back up through a new `onPagesChange` prop threaded from `App.tsx`'s existing `handleChapterPagesChange` (previously Studio had no way to mutate page image data at all). Only rectangular selections are supported, matching Photoshop's Crop tool.

**Zoom tool is real**: click zooms in centered on the cursor, Alt-click zooms out — previously selecting it and clicking the canvas did nothing (zoom only ever worked via the scroll wheel or toolbar buttons, regardless of active tool).

All of the above dispatch through **Pointer Events** (`onPointerDown/Move/Up`), not separate mouse/touch handlers — mouse, touch, and pen input share one code path. Real stylus pressure (`PointerEvent.pressure`) scales brush/pencil/eraser size (only for `pointerType === 'pen'`; mouse/touch report a flat, meaningless 0.5 per spec). A `touchCount >= 2` guard skips tool dispatch for pointer events fired mid-two-finger-gesture, deferring to the separate pinch/pan `onTouchMove` handler. Two-finger touch pans *and* pinch-zooms simultaneously (`handleTouchMove` anchors on the *previous* frame's pinch center, not the current one — a plain two-finger drag with no distance change still pans correctly).

Selection model: `paint/selection.ts`'s `Selection` union (`rect | ellipse | polygon | mask`) — vector shapes clip via `Path2D`, magic-wand masks approximate live via bounding box during a stroke and get pixel-perfect refinement on commit (`refineMaskedRegion`, now wired into every paint-stroke commit path, not just magic-wand). **Feather/expand/contract/add-subtract are real**: Shift(add)/Alt(subtract)/intersect combine the in-progress marquee/lasso/wand shape with the prior selection by rasterizing both to a mask and compositing (`combineSelections`); a **Select** menu (Deselect, Feather…, Expand…, Contract…) applies one-shot pixel-amount ops (`featherSelection`, `growSelection`) via a `swal` numeric prompt. Still not implemented: magnetic lasso, patch tool, curvature pen/path selection/direct selection — declared in `toolGroups.ts`/SPEC but not built.

### Brush engine (`paint/brushTip.ts`, `paint/brushThumbnail.ts`, `BrushesPanel.tsx`)

Stamps are cached tip canvases (`getBrushTip`), keyed by size/hardness/shape/angle/roundness/colour (+ `maskId` for image tips). A dense stroke lays hundreds of stamps, so building the tip once and blitting it beats a per-stamp `createRadialGradient`+`arc`, and it's what makes non-round tips and imported image brushes possible at all. **Tips are rendered in their final colour, not tinted white-then-recoloured** — a `source-in` tint can only be applied to a whole canvas, so tinting the dirty sub-rect of a page-sized stroke buffer would wipe the rest of the stroke.

**Flow and opacity are genuinely separate**, Photoshop-style: `usePaintLayer` accumulates a whole stroke into a scratch buffer at `flow`, then composites that buffer onto the layer at `opacity`, restoring only the dirty rect (`compositeStroke`). Painting straight onto the layer at `opacity * flow` — which is what this used to do — lets overlapping stamps within one stroke blow past the opacity cap, making the two sliders indistinguishable. Also real: spacing, angle, roundness (elliptical/calligraphic tips), scatter, pull-string smoothing, square tips, and pressure independently driving size and/or opacity.

`BrushCursor.tsx` draws the live outline (size x zoom, angle/roundness, dashed inner ring at a soft tip's falloff, crosshair under 4px) as **SVG above the Konva stage**, so it can never reach exports or the layer stack. The OS cursor is hidden while a brush-sized tool is armed.

Brush presets (`src/lib/brushStore.ts`, idb-keyval `brush_presets`, schema-versioned) are plain parameter sets over that one engine — there is deliberately no separate "brush type", so an imported or duplicated brush is exactly as capable as a built-in. Built-ins live in code and are re-merged on load (only their `favorite` flag persists), so shipping a new one needs no migration. Panel thumbnails are drawn by the **real engine** (`renderBrushThumbnail` calls `strokeSegment`), so spacing gaps, scatter and pressure taper all show up truthfully. Imported images are baked to an alpha mask once at import (`imageToBrushMask`, alpha = 255 - luminance, existing alpha respected) rather than re-derived per stamp. **Favorites is a virtual folder** — a view over the flag, not a location.

**Note:** reading `e.target.files` and then setting `e.target.value = ''` before consuming it silently drops the upload — `FileList` is live, so clearing the input empties it. Snapshot with `Array.from(...)` first. This had already broken font upload in `FontsPanel`.

**Brush symmetry is real** (`PaintSettings.symmetry`, a Symmetry dropdown in the tool options bar for Brush/Pencil/Eraser): `usePaintLayer.ts`'s `applyStrokeSegment` mirrors each *segment* (not a post-hoc flip of the finished stroke) across the canvas center — `horizontal` flips left-right, `vertical` flips top-bottom, `both` draws all four. Only mirrors around the canvas center, not an arbitrary user-placed axis, and only for the three raw-stroke tools (not clone/filter-brush/liquify) — a real, honestly-scoped subset of what "brush symmetry" can mean.

**Liquify** (`paintEngine.ts`'s `liquify()`) is real — `push`/`swirl`/`pinch`/`bloat`/`crystalize`/`reconstruct` modes. The first five each compute a per-pixel *source sample offset* (a true warp, not a blend) with radial falloff, same getImageData/putImageData-over-a-bounding-box pattern as the filter brushes. `reconstruct` blends back toward a pristine pre-liquify snapshot instead — `StudioCanvas.tsx`'s `liquifySnapshots` registry captures one lazily per layer, on that layer's first-ever liquify edit (mirrors `paintCanvasRegistry`'s per-layer-id-not-page-id pattern), and it's cleared when the layer is deleted.

**Gradient** tool now goes foreground→background (`settings.bgColor`), matching Photoshop's default convention, instead of the old hardcoded foreground→transparent-white.

Grid (`showGrid`) and rulers (`showRulers`) are real, toggled from the View menu — grid is a Konva overlay layer at a fixed 100px page-space spacing; rulers are HTML overlays tracking `pos`/`scale` with tick labels every 100px.

### Persistence

Two separate IndexedDB stores, deliberately kept apart so painting never triggers a full-library rewrite:

- `workspaces_library` (existing, `App.tsx`) — chapter/page structure + image data URLs.
- `studio_<chapterId>` (`src/lib/studioProjectStore.ts`) — layers (with raster pixels as data URLs), TypeR script/styles. Autosaved 1.2s after the last layer/TypeR change *or* committed paint stroke (`Studio.tsx`'s `scheduleAutosave`/`flushAutosave`). Loaded on mount; raster layers hydrate lazily as each page is visited (`loadRasterLayer` polls briefly for the background image to finish loading — see `waitForImage` in `StudioCanvas.tsx`).
- `studio_versions_<chapterId>` — capped (10) full-copy version snapshots pushed on every autosave. No diffing/compaction; fine at this scale, revisit only if real usage shows storage bloat.
- `text_styles` (`src/lib/textStyleStore.ts`) — saved character/paragraph text styles. App-wide, not per-chapter (a style is meant to be reused across projects), which is why it isn't folded into `studio_<chapterId>`.

`studio_<chapterId>` is at **schema v3** (`STUDIO_SCHEMA_VERSION`; v2 added `autoWidth`/`letterSpacing`/`shadow`, v3 added `gradient`). `migrateTextLayers` runs on *any* mismatched version and every backfill in it is an idempotent `??`, so one pass takes v1 or v2 straight to current — don't restructure it into a per-step chain without keeping that property. This matters because the renderer/panel read nested fields (`text.shadow`, `text.gradient`) directly, so an un-backfilled layer throws on open.

Native project format: `.msp` (zipped JSON containing the full workspace tree + every chapter's studio data), `src/lib/mspFile.ts`. Export/import UI lives in `App.tsx`'s workspace list (not inside Studio, since it operates on a whole workspace).

### Export (`src/lib/exportImage.ts`, `src/lib/exportPsd.ts`)

- PNG/JPG/WEBP: `StudioCanvasHandle.getExportSnapshot()` captures background + full layer stack (raster layers as data URLs, text layers as structured data) for the active page; `compositeFlattenedImage()` flattens onto a canvas respecting opacity/blend/visibility, rendering text layers via canvas 2D (`fillText`/`strokeText`, with manual greedy word-wrap to approximate Konva's auto-wrap). JPG flattens onto white first (no alpha channel). `drawTextLayer` derives the text's **real** box before drawing — point text (`autoWidth`) is never wrapped and is measured, since its stored `width` is not its actual size; that box then drives wrapping, centring *and* the gradient vector, so all three stay consistent with the canvas.
- PSD: `exportPsd()` builds an `ag-psd` `Psd` object — one layer per `StudioLayer`, raster layers get a canvas, text layers get `LayerTextData` (editable in Photoshop; font family names pass through as-is, Photoshop substitutes if not installed — can't resolve that from a browser), and gradient text adds a `gradientOverlay` effect (see Text layers above). `ag-psd` is **dynamically imported** (`await import('ag-psd')`) so it code-splits into its own chunk instead of bloating the main bundle (it's ~300KB alone) — its *types* are safe to import at top level, since `import type` is erased.
- `ExportDialog.tsx` wires both into the Project menu / `Ctrl/Cmd+E`.

Text export (TXT/DOCX/PDF) lives in `src/lib/textEditorExport.ts` — see the Text Editor section below.

### Text layers (`TextPanel.tsx`, `textGradient.ts`, `src/lib/textStyleStore.ts`)

One `TextLayerData` carries **one flat style for the whole layer** — there is no run/span model. That single fact is what makes several Photoshop text features unbuildable here; see Known gaps.

Real: point vs box text (`autoWidth` — point text has no author width and never wraps, so Konva's laid-out box is the *only* source of its real size), tracking (`letterSpacing`), leading (`lineHeight`), shadow/glow (a glow is a shadow at 0/0 with a wide blur), stroke, rotation + 8 transform anchors.

**Gradient text is real** (`TextLayerData.gradient`). `textGradient.ts`'s `gradientVector(w, h, angleDeg)` is shared by the canvas renderer and the raster exporter so the two can't drift; it *projects* the box onto the gradient direction rather than running corner-to-corner, so the ramp spans the full box at any angle. Angle is degrees clockwise from left-to-right in **screen coords (y down)**, so 90° = top-to-bottom.

Three things about it are load-bearing and easy to break:
- Konva's `fillPriority` defaults to `'color'`, so a node with both `fill` and gradient stops silently renders the **flat colour**. `StudioCanvas` must set `fillPriority='linear-gradient'` when a gradient is on.
- The gradient start/end points **can't be props** — point text's box is only known after Konva lays it out. They're set imperatively in a `useEffect` keyed on `layers`, reading `textNodeRefs` (React commits Konva props before effects run, so `node.width()` is already current). Re-deriving the measurement instead would drift from what Konva actually drew.
- PSD carries the gradient as a `gradientOverlay` **effect** (how it's done by hand in Photoshop, and still editable there), with `style.fillColor` left as the flat colour underneath. ag-psd normalizes stop `location`/`midpoint`/`opacity` to **0..1** and scales them on write — they are *not* raw 0..4096 PSD units. Photoshop's angle is counter-clockwise/y-up, so `exportPsd` negates ours.

**Character and paragraph styles are real** (`src/lib/textStyleStore.ts`, idb-keyval `text_styles`, schema-versioned). A character style captures appearance (font/size/colour/bold/italic/tracking/stroke/shadow/gradient); a paragraph style captures layout (align/lineHeight/autoWidth). `CHARACTER_STYLE_KEYS`/`PARAGRAPH_STYLE_KEYS` are the single source of truth for both capture and apply — applying one touches **only** its own subset, which is the whole point of the split (restyle layout without overwriting the font). Capture and apply both `structuredClone`, so a saved style never shares its nested `shadow`/`gradient` object with a layer.

### TypeR (scripted lettering)

`studioTypes.ts`'s `parseTyperScript()` + `TyperPanel.tsx`. Paste a script, arm it, click bubbles to stamp lines in order with per-line styles matched by prefix (longest prefix wins; empty-prefix style is the catch-all).

Ported from the real TypeR 2.5 extension's documented behavior (see `src/assets/claude.md` for the original algorithm description, and `src/assets/mangastudio (1).html` for a working reference implementation):
- `##`-prefixed lines are ignored (notes).
- `//`-prefixed lines continue (append to) the previously placed line rather than starting a new one.
- `Page N` control lines (English or Arabic, incl. Arabic-Indic digits) tag the next real line with a page hint; `Studio.tsx` auto-switches pages as the armed script advances onto a hinted line (matches by number extracted from the target page's filename, falling back to 1-based position).
- A line fully wrapped in `**bold**`/`<b>...</b>` or `*italic*`/`<i>...</i>` overrides that style's weight for just that placement.
- Styles have an optional `folder` field for organizing the panel into collapsible groups — **folder does not affect prefix-matching priority** (simplified from the original "focused folder" UI concept, which doesn't exist here); matching is purely longest-prefix-first across all styles.

**Multi-Bubble mode is real**: toggle it on in the TypeR panel (a "Layers"-icon button next to Arm), and arming switches the active tool to Rectangular Marquee instead of Text. Draw a rect per bubble and click "Add Bubble" to queue it (rendered as a distinct amber dashed overlay, `StudioCanvas`'s `queuedBubbleRects` prop, alongside the normal white live-selection outline) — then "Place All" stamps each queued rect's line, in script order, centered in that rect, in one `updateLayers` call (`Studio.tsx`'s `handleAddBubbleRect`/`handlePlaceAllBubbles`). **Not implemented**: true per-character rich text (bold/italic overrides apply to the whole placed layer, since `TextLayerData` has no per-run styling — would need either rich HTML content or a run-based text model, a bigger change than this pass covers).

### Translation Preview panel

`TranslationPreviewPanel.tsx` — lists every text layer across every page in the chapter (reads `layersByPage` directly, no extra loading needed since it's already all in memory), with jump-to-bubble, cross-page search/replace, and per-dialogue status (`draft/translated/reviewed`) + comment fields on `TextLayerData`. Cross-page edits go through `Studio.tsx`'s `updateLayersOnPage()` (a generalization of the original active-page-only `updateLayers()`).

### Dock/panel system (`dock/`)

`DockContext.tsx` manages which tab is active in the `top`/`bottom` regions and which tabs are floating (`FloatingPanel.tsx`, drag + resize). Layout (active tabs + floating rects) persists to `localStorage` under `dock_layout_<chapterId>`, debounced — scoped per chapter so switching projects doesn't bleed one chapter's panel arrangement into another's. `homeRegion` (which region a tab defaults to) is static (`dockLayout.ts`'s `DEFAULT_DOCK_REGION`) and never mutated at runtime, so it isn't persisted.

Responsive breakpoints (`Studio.tsx`'s `layoutMode`): `desktop` (≥1024px, side dock), `tablet` (768–1024px, dock collapses to a tap-to-open icon strip overlay), `phone` (<768px, dock opens as a near-full-height slide-in sheet — `animate-slide-up-sheet` in `index.css` — with a drag-handle/close affordance, not a fixed-height strip). Tool rail is already icon-only/horizontal on phone via existing `lg:hidden` breakpoint classes; StudioToolbar serves as the top mini-bar on every breakpoint.

Fullscreen: native Fullscreen API on the Studio root, synced to `fullscreenchange` (not just button state, so Esc/browser UI stays in sync). Not bound to literal F11 — browsers intercept that key at the chrome level before JS reliably sees it — bound to `Ctrl/Cmd+Shift+F` instead. `Tab` hides all panels (menu bar, tool options, tool rail, dock, floating panels), guarded against firing while any input/textarea/contenteditable has focus.

Window menu items render real checkmarks (`Menu.tsx`'s `checked` field) reflecting actual panel/fullscreen/hidden state — not decorative.

### Workflow stage pills

A stage-pill strip (Chapter → Page → Detection → Cleaning → Drawing → Typesetting → Review → Export), type/logic in `WorkflowBar.tsx` (just the `WorkflowStage` interface now — the actual pill rendering was folded into `StudioToolbar.tsx` as a `workflowStages` prop to cut the Studio down from four stacked chrome bars — menu bar, toolbar, workflow bar, tool options bar — to at most three; the pills are hidden below the `lg` breakpoint to keep the merged row from overflowing on tablet/phone, where the tool rail already collapses too). Every "active" pill reflects a real, checkable condition (has a cleaned page, has a `clean-patch` layer, has a non-empty text layer); Detection/Review/Export are shown dim/untracked since nothing in the app tracks those stages yet — deliberately not faked.

## Text Editor (`src/components/textEditor/TextEditorPage.tsx`)

A standalone top-level page (`src/config/navTabs.ts`'s `'text-editor'` nav tab), **not** embedded in Studio — reached via the sidebar/bottom nav, matching the "own page, own switcher" requirement. TypeR itself is Studio-only; the editor connects to it one-way via a "Send to TypeR" pipeline (see below).

- **Multi-document tabs**: `TextEditorDoc[]` (`src/lib/textEditorStore.ts`), each with its own pages, persisted to IndexedDB (`text_editor_docs` key, separate from both Studio stores).
- **Pagination**: each doc's pages are A4-sized (`794×1123px`) `contentEditable` divs. `reflow()` does direct DOM manipulation on refs — pushes overflowing trailing block-children to the next page, pulls blocks back up from the next page to fill gaps — and only touches React state to change *page count* (splice the array, keep every untouched page's string reference identical). This is deliberate: re-rendering a page's `dangerouslySetInnerHTML` on every keystroke would reset that page's DOM and kill the caret mid-typing, so normal content edits never flow back through state — only autosave (on a debounce timer, captured fresh from refs) and explicit bulk actions (spell-check apply, find/replace, doc switch) do, and those intentionally force a full page re-render via `renderKey`.
- **Formatting**: `document.execCommand`-based toolbar (bold/italic/underline/headings/lists/align) — the same pragmatic approach the reference prototype used; no custom rich-text model.
- **Spell-check**: `src/lib/spellCheck.ts` — a small starter EN+AR misspelling dictionary (not a full language dictionary — there's no server to back a real one), flags exact-word matches as clickable `.spell-miss` spans, click-to-fix. `stripSpellMarks()` always runs before export/send, matching the reference prototype's "export strips spell marks" convention.
- **Export**: TXT (real, `pageToPlainText`), DOCX (real, via the `docx` npm package — dynamically imported so it doesn't bloat the main bundle, block-level HTML→paragraph/run mapping with bold/italic/underline/heading levels preserved), PDF (`printDocAsPdf` opens a print-formatted window with `@media print` A4 page breaks exactly matching the on-screen pages, then calls `window.print()` — deliberately avoids a heavy client-side PDF-rendering library since the browser's native print-to-PDF already produces print-quality, pixel-accurate output).
- **Send to TypeR**: strips spell marks, joins all pages' plain text, and calls `onSendToTyper` → `App.tsx`'s `pendingTyperScript` state → `Studio.tsx` consumes it into `typerScript` on mount and clears it. This means the text is "waiting" in whichever chapter's Studio the user opens next, without either page needing to be mounted simultaneously.
- **Not implemented this pass**: tables, images, comments, track changes, and the *optional* in-editor floating panels (Translation Preview and a live read-only page thumbnail) that SPEC describes as opt-in helpers while writing — real, separate scope beyond a first working editor. No dedicated "switch Studio ↔ Editor" keyboard shortcut either; switching is one click via the existing nav rail/tab bar.

## Color system (`color/ColorPanel.tsx`)

RGB/Hex/HSV wheel + recent colors were already real; HSL and CMYK rows now use `colord` (+ its `cmyk` plugin, `extend([cmykPlugin])`) for the conversions rather than hand-rolled math — small, well-tested library, not bundled-heavy (a few KB, stays in the main chunk). **Saved palettes are real** — `src/lib/paletteStore.ts` (idb-keyval, `color_palettes` key, mirrors `fontsStore.ts`'s pattern) backs named `ColorPalette` lists in `ColorContext`; the panel's Palettes section lets you create/delete a palette and add/remove swatches (right-click a swatch to remove it). **Not implemented**: a dedicated multi-stop gradient editor UI (the Gradient *tool* itself is real and goes foreground→background, see Canvas engine above — there's just no UI for arbitrary custom gradient stops beyond that one pair).

## Fonts (`FontsPanel.tsx`, `src/lib/fontLoader.ts`, `src/lib/fontsStore.ts`)

Real font installation: upload TTF/OTF/WOFF/WOFF2 → `opentype.js` (dynamically imported) parses the embedded family name → registered via the `FontFace` API (`document.fonts.add`) → persisted to IndexedDB (`custom_fonts` key) and re-registered on every load. Installed families flow into `Studio.tsx`'s `allFontFamilies` (built-ins + custom) and are passed to both `TextPanel` and `TyperPanel` as a `fontFamilies` prop (defaults to the built-in list if omitted) — TypeR styles have always had a `fontFamily` field, and the style editor's Font select now actually drives it. **Google Fonts integration is intentionally not implemented** — SPEC lists it as optional, and pulling from Google's CDN would require network access, conflicting with this app's offline-capable design intent.

## Known gaps (honest, not silently dropped)

- **No Home/landing page.** Top nav is 5 flat tabs (Library/Text Editor/Settings/Teams/Cloud); Recent/Templates/Tutorials/Plugins/Account don't exist. Building nav destinations with no real content behind them would violate the no-placeholder rule — needs real features first.
- **Interactive control sizing** on mobile/tablet breakpoints hasn't had a systematic ≥44px touch-target pass — many buttons/sliders are still 24–32px (a few new additions, like the tablet dock icon strip, were sized to 44px; the sweep across every existing control wasn't done).
- **Layer groups/masks/smart objects** (adjustment layers *are* implemented, background-only — see Per-page layer stack above), **magnetic lasso**, **patch tool**, **curvature pen / path selection / direct selection** — declared as intended features (in tool lists, type unions, or SPEC) but not implemented. Each is a genuinely separate chunk of work. (Selection feather/expand/contract/add-subtract, liquify's `reconstruct` mode, Crop, TypeR's Multi-Bubble mode, and brush symmetry *are* implemented — see Canvas engine / TypeR above.)
- **Move tool only repositions text layers.** Clean-patch (raster) and adjustment layers have no `x`/`y` offset in the data model and their Konva nodes aren't draggable — Move-tool support for them would need per-layer offset fields plus a Group wrapper (and matching changes to export/flatten), a real, separate piece of work like layer groups/masks above.
- **Text: kerning, baseline shift, warp, and per-character rich text** — all blocked on the same thing: `TextLayerData` holds one flat style per layer, with no run/span model. Baseline shift and kerning are per-character by definition (a layer-wide baseline shift is just a y-offset, which moving the layer already does; kerning is per-pair and font-driven, with no browser control beyond tracking — `letterSpacing`), so exposing either against a flat model would be a control that lies. Warp additionally needs path-based glyph rendering, which Konva's `Text` has no support for. A run-based text model is the prerequisite for all of them, and would also unlock TypeR's whole-layer-only bold/italic overrides — it's a real, separate chunk of work touching the renderer, both export paths, and the schema. **Gradient text and character/paragraph styles *are* implemented** — see Text layers above.
- **Color**: no multi-stop gradient editor UI (saved palettes *are* implemented, see Color system above; gradient *text* is real but is a two-stop from→to ramp, same as the Gradient tool). **Fonts**: no Google Fonts (by design, offline-first; TypeR style font-family control *is* implemented, see Fonts above). **Music player, navigator/minimap, safe-area overlay** — not implemented (Grid and Rulers *are* implemented, see Canvas engine above).
- **Text editor**: no tables/images/comments/track-changes, no in-editor floating Translation-Preview/page-thumbnail panels, no dedicated Studio↔Editor shortcut.

## Conventions

- Keep the two IndexedDB stores (`workspaces_library` vs `studio_<chapterId>`) separate — don't fold raster/layer data into the main library object; that was a deliberate autosave-cost decision.
- New persisted shapes should include a `schemaVersion` field and a real migration path (see `migrate.ts` for the pattern), not just hope old data happens to still parse.
- Large/optional dependencies (`ag-psd`, `docx`, `opentype.js`) are dynamically imported (`await import(...)`), not top-level, to keep the main bundle lean — check `npm run build`'s chunk output after adding a new one; it should show up as its own chunk, not inflate the main one. Small libraries (`colord`, a few KB) are fine as regular top-level imports.
- `npm run lint` is actually `tsc --noEmit` (no separate linter configured) — run it after any change; `npm run build` is the stronger check since Vite/Rollup catch a few things `tsc --noEmit` alone doesn't.
- This session ported algorithms/behavior from two references: `src/assets/mangastudio (1).html` (a disconnected single-file prototype — TypeR parsing model, Tab-hide-panels, teReflow pagination) and the documentation in `src/assets/claude.md` (Arabic, describes that prototype's contracts). Both are read-only reference material, not part of the shipping app — don't wire them in or assume their code paths exist here.
