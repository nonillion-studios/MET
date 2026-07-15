import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Page } from '../../types';
import { StudioToolbar } from './StudioToolbar';
import { StudioCanvas, type StudioCanvasHandle } from './StudioCanvas';
import { StudioPagesPanel } from './StudioPagesPanel';
import { ToolRail } from './ToolRail';
import { RightDock } from './RightDock';
import { LayersPanel } from './LayersPanel';
import { TextPanel } from './TextPanel';
import { TyperPanel } from './TyperPanel';
import { ColorProvider, useColor } from './color/ColorContext';
import { ColorPanel } from './color/ColorPanel';
import { HistoryProvider, useHistory } from './history/HistoryContext';
import { HistoryPanel } from './history/HistoryPanel';
import { useKeyboardUndo } from './history/useKeyboardUndo';
import { DockProvider, useDock } from './dock/DockContext';
import { FloatingPanel } from './dock/FloatingPanel';
import { DOCK_PANEL_GROUP_AUTOSAVE_ID } from './dock/dockLayout';
import { NO_SELECTION, hasSelection, featherSelection, growSelection, type Selection } from './paint/selection';
import type { PaintSettings, LiquifyMode, SymmetryMode } from './paint/paintEngine';
import type { BrushShape } from './paint/brushTip';
import { PAINT_TOOLS } from './paint/usePaintLayer';
import { ToolOptionsBar } from './toolOptions/ToolOptionsBar';
import { useStudioShortcuts } from './shortcuts/useStudioShortcuts';
import { FIXED_SHORTCUTS_HELP } from './shortcuts/shortcutsMap';
import { MenuBar } from './menu/MenuBar';
import { buildMenus } from './menu/menuDefinitions';
import { swal, swalToast } from '../../lib/swalTheme';
import { ExportDialog } from './ExportDialog';
import { TranslationPreviewPanel } from './TranslationPreviewPanel';
import { exportPsd } from '../../lib/exportPsd';
import {
  createBackgroundLayer, createLayer, createTextLayer, createAdjustmentLayer, parseTyperScript,
  DEFAULT_TYPER_STYLES, FONT_FAMILIES, type StudioLayer, type TextLayerData, type TyperStyle,
  type AdjustmentLayerData,
} from './studioTypes';
import { FontsPanel } from './FontsPanel';
import { BrushesPanel } from './BrushesPanel';
import type { BrushPreset } from '../../lib/brushStore';
import { AdjustmentPanel } from './AdjustmentPanel';
import {
  loadChapterStudioData, saveChapterStudioData, pushVersionSnapshot, STUDIO_SCHEMA_VERSION,
  type ChapterStudioData, type SerializedStudioLayer,
} from '../../lib/studioProjectStore';

const AUTOSAVE_DEBOUNCE_MS = 1200;

interface StudioProps {
  chapterId: string;
  chapterName: string;
  pages: Page[];
  onBack: () => void;
  /** Text sent from the standalone Text Editor page's "Send to TypeR" button, waiting to be picked up. */
  pendingTyperScript?: string | null;
  onConsumePendingTyperScript?: () => void;
  /** Persists page image changes (currently just Crop) back up to the workspace tree. */
  onPagesChange?: (pages: Page[]) => void;
}

export function Studio(props: StudioProps) {
  return (
    <ColorProvider>
      <HistoryProvider>
        <DockProvider storageKey={props.chapterId}>
          <StudioInner {...props} />
        </DockProvider>
      </HistoryProvider>
    </ColorProvider>
  );
}

function StudioInner({ chapterId, chapterName, pages, onBack, pendingTyperScript, onConsumePendingTyperScript, onPagesChange }: StudioProps) {
  const canvasRef = useRef<StudioCanvasHandle>(null);
  const { foreground, background, setForeground, swap: swapColors, reset: resetColors } = useColor();
  const history = useHistory();
  useKeyboardUndo();
  const dock = useDock();
  const [brushSize, setBrushSize] = useState(24);
  const [brushHardness, setBrushHardness] = useState(0.8);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushFlow, setBrushFlow] = useState(1);
  const [tolerance, setTolerance] = useState(32);
  const [liquifyMode, setLiquifyMode] = useState<LiquifyMode>('push');
  const [symmetry, setSymmetry] = useState<SymmetryMode>('none');
  const [spacing, setSpacing] = useState(0.15);
  const [brushShape, setBrushShape] = useState<BrushShape | 'image'>('round');
  const [brushAngle, setBrushAngle] = useState(0);
  const [brushRoundness, setBrushRoundness] = useState(1);
  const [scatter, setScatter] = useState(0);
  const [smoothing, setSmoothing] = useState(0);
  const [pressureSize, setPressureSize] = useState(true);
  const [pressureOpacity, setPressureOpacity] = useState(false);
  const [activeBrushId, setActiveBrushId] = useState<string | null>(null);
  /** Decoded tip mask for the active image brush; undefined for procedural shapes. */
  const [tipMask, setTipMask] = useState<HTMLCanvasElement | undefined>(undefined);
  const paintSettings: PaintSettings = {
    size: brushSize, hardness: brushHardness, opacity: brushOpacity, flow: brushFlow,
    color: foreground, bgColor: background, tolerance, liquifyMode, symmetry,
    spacing, brushShape, angle: brushAngle, roundness: brushRoundness,
    scatter, smoothing, pressureSize, pressureOpacity,
    tipMask, tipMaskId: brushShape === 'image' ? activeBrushId ?? undefined : undefined,
  };

  /** Applying a preset just writes the engine state — there's no separate "brush mode",
   *  so the options bar and the panel always describe the same live brush. */
  function handleSelectBrush(preset: BrushPreset, mask?: HTMLCanvasElement) {
    setActiveBrushId(preset.id);
    setBrushSize(preset.size);
    setBrushHardness(preset.hardness);
    setBrushOpacity(preset.opacity);
    setBrushFlow(preset.flow);
    setSpacing(preset.spacing);
    setBrushAngle(preset.angle);
    setBrushRoundness(preset.roundness);
    setScatter(preset.scatter);
    setSmoothing(preset.smoothing);
    setPressureSize(preset.pressureSize);
    setPressureOpacity(preset.pressureOpacity);
    setBrushShape(preset.shape);
    setTipMask(preset.shape === 'image' ? mask : undefined);
    if (!(PAINT_TOOLS as readonly string[]).includes(activeTool)) setActiveTool('brush');
  }
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);

  async function promptSelectionAmount(title: string, label: string): Promise<number | null> {
    const result = await swal({
      title,
      input: 'number',
      inputLabel: label,
      inputValue: 10,
      showCancelButton: true,
      confirmButtonText: 'Apply',
    });
    if (!result.isConfirmed || result.value === undefined || result.value === '') return null;
    return Number(result.value);
  }

  async function handleFeatherSelection() {
    if (!activePage) return;
    const amount = await promptSelectionAmount('Feather Selection', 'Radius (px)');
    if (amount === null || amount <= 0) return;
    setSelection(sel => featherSelection(sel, amount, activePage.original.width, activePage.original.height));
  }

  async function handleExpandSelection() {
    if (!activePage) return;
    const amount = await promptSelectionAmount('Expand Selection', 'Amount (px)');
    if (amount === null || amount <= 0) return;
    setSelection(sel => growSelection(sel, amount, activePage.original.width, activePage.original.height));
  }

  async function handleContractSelection() {
    if (!activePage) return;
    const amount = await promptSelectionAmount('Contract Selection', 'Amount (px)');
    if (amount === null || amount <= 0) return;
    setSelection(sel => growSelection(sel, -amount, activePage.original.width, activePage.original.height));
  }

  /** Commits the Crop tool's rect selection: trims the background + every raster layer's canvas,
   *  shifts text layers to match, and persists the new page dimensions back up to App.tsx. */
  async function handleCommitCrop() {
    if (!activePage) return;
    if (selection.kind !== 'rect') {
      swalToast({ icon: 'info', title: 'Draw a rectangular crop area first' });
      return;
    }
    const rect = selection;
    const result = await canvasRef.current?.commitCrop(rect);
    if (!result) return;
    onPagesChange?.(pages.map(p => p.id === activePage.id ? { ...p, original: result.original, cleaned: result.cleaned } : p));
    updateLayers(current => current.map(l =>
      l.type === 'text' && l.text ? { ...l, text: { ...l.text, x: l.text.x - rect.x, y: l.text.y - rect.y } } : l
    ), 'Crop');
    setSelection(NO_SELECTION);
    setActiveTool('select');
    setFitSignal(s => s + 1);
    scheduleAutosave();
    swalToast({ icon: 'success', title: 'Cropped' });
  }

  const studioRootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(document.fullscreenElement === studioRootRef.current); }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      studioRootRef.current?.requestFullscreen().catch(() => {
        swalToast({ icon: 'error', title: "Couldn't enter fullscreen" });
      });
    }
  }

  useStudioShortcuts({
    onToolChange: (id) => setActiveTool(id),
    onBrushSizeStep: (delta) => setBrushSize(v => Math.max(1, Math.min(200, v + delta))),
    onSwapColors: swapColors,
    onResetColors: resetColors,
    onZoomIn: () => canvasRef.current?.zoomIn(),
    onZoomOut: () => canvasRef.current?.zoomOut(),
    onFit: () => setFitSignal(s => s + 1),
    onToggleCleaned: () => setShowCleaned(v => !v),
    onToggleFullscreen: toggleFullscreen,
    onTogglePanelsHidden: () => setPanelsHidden(v => !v),
    onExport: () => setExportOpen(true),
  });
  const [activePageId, setActivePageId] = useState<string | null>(pages[0]?.id ?? null);
  const [activeTool, setActiveTool] = useState('select');
  const [showCleaned, setShowCleaned] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const [customFontFamilies, setCustomFontFamilies] = useState<string[]>([]);
  const allFontFamilies = [...FONT_FAMILIES, ...customFontFamilies];
  const [fitSignal, setFitSignal] = useState(0);
  const [dockOpen, setDockOpen] = useState(true);
  const [tabletOverlayTab, setTabletOverlayTab] = useState<string | null>(null);
  const tabletOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabletOverlayTab) return;
    function onPointerDown(e: PointerEvent) {
      if (tabletOverlayRef.current && !tabletOverlayRef.current.contains(e.target as Node)) {
        setTabletOverlayTab(null);
      }
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [tabletOverlayTab]);

  // Per-page layer stacks. Each page always has a locked "Background" layer at index 0.
  const [layersByPage, setLayersByPage] = useState<Record<string, StudioLayer[]>>({});
  const [activeLayerId, setActiveLayerId] = useState<string | null>('background');

  // TypeR: scripted lettering — paste a script, arm it, click bubbles to stamp lines in order.
  const [typerScript, setTyperScript] = useState('');
  const [typerStyles, setTyperStyles] = useState<TyperStyle[]>(DEFAULT_TYPER_STYLES);
  const [typerIndex, setTyperIndex] = useState(0);
  const [typerArmed, setTyperArmed] = useState(false);
  const typerLines = useMemo(() => parseTyperScript(typerScript, typerStyles), [typerScript, typerStyles]);
  // Multi-Bubble mode: draw a rect per bubble (Rectangular Marquee) and queue it instead of
  // placing immediately, then place every queued rect's line in one go, in script order.
  const [multiBubbleMode, setMultiBubbleModeState] = useState(false);
  const [multiBubbleRects, setMultiBubbleRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);

  function setMultiBubbleMode(enabled: boolean) {
    setMultiBubbleModeState(enabled);
    setMultiBubbleRects([]);
    if (typerArmed) setActiveTool(enabled ? 'marquee-rect' : 'text');
  }

  function handleAddBubbleRect() {
    if (selection.kind !== 'rect') {
      swalToast({ icon: 'info', title: 'Draw a rectangle around a bubble first' });
      return;
    }
    setMultiBubbleRects(prev => [...prev, selection]);
    setSelection(NO_SELECTION);
  }

  function handlePlaceAllBubbles() {
    if (multiBubbleRects.length === 0) return;
    const newLayers: StudioLayer[] = [];
    let idx = typerIndex;
    for (const rect of multiBubbleRects) {
      const line = typerLines[idx];
      if (!line) break;
      const { content, style, boldOverride, italicOverride } = line;
      const lineCount = content.split('\n').length || 1;
      const textWidth = Math.max(40, Math.min(rect.width, 400));
      const textHeight = lineCount * style.fontSize * 1.15;
      const layer = createTextLayer(rect.x + rect.width / 2 - textWidth / 2, rect.y + rect.height / 2 - textHeight / 2);
      layer.name = `Text: ${content.slice(0, 20)}`;
      layer.text = {
        ...layer.text!,
        content,
        width: textWidth,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        bold: boldOverride ?? style.bold,
        italic: italicOverride ?? style.italic,
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
      };
      newLayers.push(layer);
      idx += 1;
    }
    updateLayers(current => [...current, ...newLayers], 'Place TypeR Multi-Bubble');
    setTyperIndex(idx);
    if (idx >= typerLines.length) setTyperArmed(false);
    setMultiBubbleRects([]);
    setActiveTool('select');
    swalToast({ icon: 'success', title: `Placed ${newLayers.length} line${newLayers.length === 1 ? '' : 's'}` });
  }

  // Pick up text sent from the Text Editor's "Send to TypeR" button, if any is waiting.
  useEffect(() => {
    if (pendingTyperScript == null) return;
    setTyperScript(pendingTyperScript);
    onConsumePendingTyperScript?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTyperScript]);

  // TypeR "Page N" auto page-switching: when the armed script advances onto a line tagged with
  // a page hint, jump there automatically (matching by number in the filename, falling back to
  // 1-based position) so placement lands on the right page without a manual page click first.
  useEffect(() => {
    if (!typerArmed) return;
    const hint = typerLines[typerIndex]?.pageHint;
    if (!hint) return;
    const wantNumber = Number(hint);
    const target = pages.find(p => {
      const match = p.original.filename.match(/(\d+)(?!.*\d)/);
      return match && Number(match[1]) === wantNumber;
    }) ?? pages[wantNumber - 1];
    if (target && target.id !== activePageId) {
      setActivePageId(target.id);
      swalToast({ icon: 'info', title: `TypeR: switched to page ${hint}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typerArmed, typerIndex, typerLines, pages]);

  // --- Persistence: load this chapter's studio data (layers, TypeR script/styles, raster
  // pixels) on mount, then autosave on change. Kept in a separate idb-keyval store from the
  // main page/chapter library so painting doesn't trigger a full-library rewrite per stroke.
  const loadedRef = useRef(false);
  const rasterByPageRef = useRef<Record<string, Record<string, string>>>({});
  const hydratedPagesRef = useRef<Set<string>>(new Set());
  const dirtyRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layersByPageRef = useRef(layersByPage);
  layersByPageRef.current = layersByPage;
  const typerScriptRef = useRef(typerScript);
  typerScriptRef.current = typerScript;
  const typerStylesRef = useRef(typerStyles);
  typerStylesRef.current = typerStyles;

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    hydratedPagesRef.current = new Set();
    rasterByPageRef.current = {};
    (async () => {
      const saved = await loadChapterStudioData(chapterId);
      if (cancelled) return;
      if (saved) {
        const nextLayersByPage: Record<string, StudioLayer[]> = {};
        const nextRasterByPage: Record<string, Record<string, string>> = {};
        for (const [pageId, serialized] of Object.entries(saved.layersByPage)) {
          nextLayersByPage[pageId] = serialized.map(({ raster: _raster, ...layer }) => layer);
          const rasterMap: Record<string, string> = {};
          for (const l of serialized) if (l.raster) rasterMap[l.id] = l.raster;
          if (Object.keys(rasterMap).length > 0) nextRasterByPage[pageId] = rasterMap;
        }
        setLayersByPage(nextLayersByPage);
        setTyperScript(saved.typerScript);
        if (saved.typerStyles.length > 0) setTyperStyles(saved.typerStyles);
        rasterByPageRef.current = nextRasterByPage;
      }
      loadedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [chapterId]);

  // Hydrate the active page's raster (painted pixel) layers once its canvas is ready.
  useEffect(() => {
    if (!loadedRef.current || !activePageId) return;
    if (hydratedPagesRef.current.has(activePageId)) return;
    hydratedPagesRef.current.add(activePageId);
    const raster = rasterByPageRef.current[activePageId];
    if (!raster) return;
    (async () => {
      for (const [layerId, dataUrl] of Object.entries(raster)) {
        await canvasRef.current?.loadRasterLayer(layerId, dataUrl);
      }
    })();
  }, [activePageId, layersByPage]);

  function scheduleAutosave() {
    dirtyRef.current = true;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
  }

  function flushAutosave() {
    if (!dirtyRef.current || !loadedRef.current) return;
    dirtyRef.current = false;
    // Covers every raster layer touched so far this session (any page, not just the active one —
    // the paint canvas registry keeps every visited page's canvases alive until its layer is deleted).
    const liveRaster = canvasRef.current?.exportRasterLayers() ?? {};
    const mergedLayersByPage: Record<string, SerializedStudioLayer[]> = {};
    for (const [pageId, pageLayers] of Object.entries(layersByPageRef.current)) {
      mergedLayersByPage[pageId] = pageLayers.map((l) => {
        const raster = liveRaster[l.id] ?? rasterByPageRef.current[pageId]?.[l.id];
        return raster ? { ...l, raster } : l;
      });
    }
    const data: ChapterStudioData = {
      schemaVersion: STUDIO_SCHEMA_VERSION,
      layersByPage: mergedLayersByPage,
      typerScript: typerScriptRef.current,
      typerStyles: typerStylesRef.current,
      updatedAt: new Date().toISOString(),
    };
    saveChapterStudioData(chapterId, data).catch(console.error);
    pushVersionSnapshot(chapterId, data).catch(console.error);
  }

  useEffect(() => {
    if (loadedRef.current) scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersByPage, typerScript, typerStyles]);

  // Flush a pending save immediately when leaving this chapter's Studio (e.g. "Back to Pages").
  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    flushAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pages.find(p => p.id === activePageId)) {
      setActivePageId(pages[0]?.id ?? null);
    }
  }, [pages, activePageId]);

  const activePage = pages.find(p => p.id === activePageId) ?? null;

  const layers = useMemo(() => {
    if (!activePageId) return [];
    return layersByPage[activePageId] ?? [createBackgroundLayer()];
  }, [layersByPage, activePageId]);

  /** General primitive: edit any page's layer stack, not just the active one — the Translation
   *  Preview panel needs to edit dialogue text across every page in the chapter at once. */
  function updateLayersOnPage(pageId: string, updater: (current: StudioLayer[]) => StudioLayer[], historyLabel?: string) {
    const before = layersByPage[pageId] ?? [createBackgroundLayer()];
    const after = updater(before);
    setLayersByPage(prev => ({ ...prev, [pageId]: after }));
    if (historyLabel) {
      history.push({
        label: historyLabel,
        undo: () => setLayersByPage(prev => ({ ...prev, [pageId]: before })),
        redo: () => setLayersByPage(prev => ({ ...prev, [pageId]: after })),
      });
    }
  }

  function updateLayers(updater: (current: StudioLayer[]) => StudioLayer[], historyLabel?: string) {
    if (!activePageId) return;
    updateLayersOnPage(activePageId, updater, historyLabel);
  }

  function handleAddLayer() {
    const layer = createLayer('clean-patch', `Layer ${layers.length}`);
    updateLayers(current => [...current, layer], 'Add Layer');
    setActiveLayerId(layer.id);
    // New raster layers start as a working copy of the background — matches the standard
    // "duplicate scan, clean the duplicate" manga workflow and gives clone/heal/filter-brush/
    // liquify tools real pixels to act on immediately instead of an empty transparent canvas.
    canvasRef.current?.seedLayerWithBackground(layer.id);
  }

  function handleAddAdjustmentLayer() {
    const layer = createAdjustmentLayer('brightness-contrast');
    updateLayers(current => [...current, layer], 'Add Adjustment Layer');
    setActiveLayerId(layer.id);
    dock.selectTab('adjustment');
  }

  function handleUpdateAdjustmentLayer(id: string, patch: Partial<AdjustmentLayerData>) {
    updateLayers(current => current.map(l =>
      l.id === id && l.type === 'adjustment' && l.adjustment ? { ...l, adjustment: { ...l.adjustment, ...patch } } : l
    ));
  }

  function selectLayer(id: string) {
    setActiveLayerId(id);
    const type = layers.find(l => l.id === id)?.type;
    if (type === 'text') dock.selectTab('text');
    if (type === 'adjustment') dock.selectTab('adjustment');
  }

  function handleDuplicateLayer(id: string) {
    const source = layers.find(l => l.id === id);
    if (!source || source.isBackground) return;
    const copy: StudioLayer = { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} copy` };
    updateLayers(current => {
      const index = current.findIndex(l => l.id === id);
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    }, 'Duplicate Layer');
    setActiveLayerId(copy.id);
  }

  function handleDeleteLayer(id: string) {
    updateLayers(current => current.filter(l => l.id !== id), 'Delete Layer');
    canvasRef.current?.deletePaintCanvas(id);
    setActiveLayerId('background');
  }

  /** Paint strokes are committed by the time this fires; `before` is the layer's pixels just prior. */
  function handlePaintStrokeEnd(layerId: string, before: ImageData) {
    const canvas = canvasRef.current?.getPaintCanvas(layerId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push({
      label: 'Paint Stroke',
      undo: () => { ctx.putImageData(before, 0, 0); canvasRef.current?.redrawLayer(layerId); },
      redo: () => { ctx.putImageData(after, 0, 0); canvasRef.current?.redrawLayer(layerId); },
    });
    // Raster pixel edits don't touch layersByPage state, so they need an explicit autosave nudge.
    scheduleAutosave();
  }

  function handleMoveLayer(id: string, direction: 'up' | 'down') {
    updateLayers(current => {
      const index = current.findIndex(l => l.id === id);
      const swapWith = direction === 'up' ? index + 1 : index - 1;
      if (swapWith < 0 || swapWith >= current.length || current[swapWith].isBackground) return current;
      const next = [...current];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    }, 'Reorder Layer');
  }

  function handleToggleVisible(id: string) {
    updateLayers(current => current.map(l => l.id === id ? { ...l, visible: !l.visible } : l), 'Toggle Visibility');
  }

  function handleToggleLocked(id: string) {
    updateLayers(current => current.map(l => l.id === id ? { ...l, locked: !l.locked } : l), 'Toggle Lock');
  }

  function handleOpacityChange(id: string, opacity: number) {
    // Continuous slider drag — intentionally not tracked in history (would spam an entry per pixel).
    updateLayers(current => current.map(l => l.id === id ? { ...l, opacity } : l));
  }

  function handleBlendChange(id: string, blendMode: StudioLayer['blendMode']) {
    updateLayers(current => current.map(l => l.id === id ? { ...l, blendMode } : l), 'Change Blend Mode');
  }

  function handleAddTextLayer(x: number, y: number, boxWidth?: number) {
    const layer = createTextLayer(x, y, boxWidth);

    if (typerArmed && typerLines[typerIndex]) {
      const { content, style, boldOverride, italicOverride } = typerLines[typerIndex];
      layer.name = `Text: ${content.slice(0, 20)}`;
      layer.text = {
        ...layer.text!,
        content,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        bold: boldOverride ?? style.bold,
        italic: italicOverride ?? style.italic,
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
      };
      updateLayers(current => [...current, layer], 'Place TypeR Line');
      setActiveLayerId(layer.id);
      const nextIndex = typerIndex + 1;
      setTyperIndex(nextIndex);
      if (nextIndex >= typerLines.length) setTyperArmed(false);
      return;
    }

    updateLayers(current => [...current, layer], 'Add Text Layer');
    setActiveLayerId(layer.id);
    setActiveTool('select');
    dock.selectTab('text');
  }

  function handleUpdateTextLayer(id: string, patch: Partial<TextLayerData>) {
    updateLayers(current => current.map(l =>
      l.id === id && l.type === 'text' && l.text ? { ...l, text: { ...l.text, ...patch } } : l
    ));
  }

  /** Cross-page text edit, for the Translation Preview panel (search/replace, status, comments). */
  function handleUpdateTextLayerOnPage(pageId: string, id: string, patch: Partial<TextLayerData>) {
    updateLayersOnPage(pageId, current => current.map(l =>
      l.id === id && l.type === 'text' && l.text ? { ...l, text: { ...l.text, ...patch } } : l
    ));
  }

  function jumpToBubble(pageId: string, layerId: string) {
    setActivePageId(pageId);
    setActiveLayerId(layerId);
    dock.selectTab('text');
  }

  function handleCenterTextLayer(id: string) {
    canvasRef.current?.centerTextLayerInBubble(id);
  }

  const activeLayer = layers.find(l => l.id === activeLayerId) ?? null;

  // Paint-family tools need a clean-patch (raster) layer to draw onto — the Background layer has
  // no backing canvas, so without this every brush/fill/shape tool would silently no-op the moment
  // a fresh chapter is opened (Background is the default active layer). Reuse the topmost existing
  // raster layer if there is one; only create a fresh one if the stack has none at all.
  useEffect(() => {
    if (!(PAINT_TOOLS as readonly string[]).includes(activeTool) || !activeLayer) return;
    if (activeLayer.type === 'clean-patch') return;
    const existing = [...layers].reverse().find(l => l.type === 'clean-patch');
    if (existing) {
      setActiveLayerId(existing.id);
    } else {
      handleAddLayer();
      swalToast({ icon: 'info', title: 'New layer created for painting' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  const cropHintShownRef = useRef(false);
  useEffect(() => {
    if (activeTool === 'crop' && !cropHintShownRef.current) {
      cropHintShownRef.current = true;
      swalToast({ icon: 'info', title: 'Draw a rectangle, then press Enter or double-click to crop' });
    }
  }, [activeTool]);

  const layersPanel = (
    <LayersPanel
      layers={layers}
      activeLayerId={activeLayerId}
      onSelect={selectLayer}
      onToggleVisible={handleToggleVisible}
      onToggleLocked={handleToggleLocked}
      onOpacityChange={handleOpacityChange}
      onBlendChange={handleBlendChange}
      onAdd={handleAddLayer}
      onAddAdjustment={handleAddAdjustmentLayer}
      onDuplicate={handleDuplicateLayer}
      onDelete={handleDeleteLayer}
      onMove={handleMoveLayer}
    />
  );

  const pagesPanel = (
    <StudioPagesPanel pages={pages} activePageId={activePageId} onSelect={setActivePageId} orientation="vertical" />
  );

  const textPanel = activeLayer?.type === 'text' ? (
    <TextPanel layer={activeLayer} onUpdate={handleUpdateTextLayer} onCenter={handleCenterTextLayer} fontFamilies={allFontFamilies} />
  ) : null;

  const adjustmentPanel = activeLayer?.type === 'adjustment' ? (
    <AdjustmentPanel layer={activeLayer} onUpdate={handleUpdateAdjustmentLayer} />
  ) : null;

  const brushesPanel = (
    <BrushesPanel
      color={foreground}
      activeBrushId={activeBrushId}
      onSelectBrush={handleSelectBrush}
      live={{ size: brushSize, hardness: brushHardness, opacity: brushOpacity, flow: brushFlow,
        spacing, angle: brushAngle, roundness: brushRoundness, scatter, smoothing, pressureSize, pressureOpacity }}
      onLiveChange={(patch) => {
        if (patch.size !== undefined) setBrushSize(patch.size);
        if (patch.hardness !== undefined) setBrushHardness(patch.hardness);
        if (patch.opacity !== undefined) setBrushOpacity(patch.opacity);
        if (patch.flow !== undefined) setBrushFlow(patch.flow);
        if (patch.spacing !== undefined) setSpacing(patch.spacing);
        if (patch.angle !== undefined) setBrushAngle(patch.angle);
        if (patch.roundness !== undefined) setBrushRoundness(patch.roundness);
        if (patch.scatter !== undefined) setScatter(patch.scatter);
        if (patch.smoothing !== undefined) setSmoothing(patch.smoothing);
        if (patch.pressureSize !== undefined) setPressureSize(patch.pressureSize);
        if (patch.pressureOpacity !== undefined) setPressureOpacity(patch.pressureOpacity);
      }}
    />
  );

  const colorPanel = <ColorPanel />;
  const historyPanel = <HistoryPanel />;
  const fontsPanel = <FontsPanel onFamiliesChange={setCustomFontFamilies} />;

  const typerPanel = (
    <TyperPanel
      script={typerScript}
      onScriptChange={setTyperScript}
      styles={typerStyles}
      onStylesChange={setTyperStyles}
      index={typerIndex}
      onIndexChange={setTyperIndex}
      armed={typerArmed}
      onArmedChange={(armed) => { setTyperArmed(armed); if (armed) setActiveTool(multiBubbleMode ? 'marquee-rect' : 'text'); }}
      fontFamilies={allFontFamilies}
      multiBubbleMode={multiBubbleMode}
      onMultiBubbleModeChange={setMultiBubbleMode}
      queuedBubbleCount={multiBubbleRects.length}
      onAddBubbleRect={handleAddBubbleRect}
      onPlaceAllBubbles={handlePlaceAllBubbles}
    />
  );

  const translationPanel = (
    <TranslationPreviewPanel
      pages={pages}
      layersByPage={layersByPage}
      activePageId={activePageId}
      onJumpToBubble={jumpToBubble}
      onUpdateText={(pageId, layerId, patch) => handleUpdateTextLayerOnPage(pageId, layerId, patch)}
    />
  );

  const allTabs = [
    ...(textPanel ? [{ id: 'text', label: 'Text', content: textPanel }] : []),
    ...(adjustmentPanel ? [{ id: 'adjustment', label: 'Adjustment', content: adjustmentPanel }] : []),
    { id: 'typer', label: 'TypeR', content: typerPanel },
    { id: 'translation', label: 'Translation', content: translationPanel },
    { id: 'brushes', label: 'Brushes', content: brushesPanel },
    { id: 'color', label: 'Color', content: colorPanel },
    { id: 'fonts', label: 'Fonts', content: fontsPanel },
    { id: 'history', label: 'History', content: historyPanel },
    { id: 'layers', label: 'Layers', content: layersPanel },
    { id: 'pages', label: 'Pages', content: pagesPanel },
  ];
  const mobileTabs = allTabs.map(t => t.id === 'pages'
    ? { ...t, content: <StudioPagesPanel pages={pages} activePageId={activePageId} onSelect={setActivePageId} orientation="horizontal" /> }
    : t);

  const dockedTabs = (region: 'top' | 'bottom') =>
    allTabs.filter(t => !dock.isFloating(t.id) && (dock.homeRegion[t.id] ?? 'bottom') === region);

  const menus = buildMenus({
    onBack: onBack,
    onExport: () => setExportOpen(true),
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    toggleCleaned: () => setShowCleaned(v => !v),
    zoomIn: () => canvasRef.current?.zoomIn(),
    zoomOut: () => canvasRef.current?.zoomOut(),
    fit: () => setFitSignal(s => s + 1),
    toggleDock: () => setDockOpen(v => !v),
    addLayer: handleAddLayer,
    duplicateLayer: () => activeLayerId && handleDuplicateLayer(activeLayerId),
    deleteLayer: () => activeLayerId && handleDeleteLayer(activeLayerId),
    moveLayerUp: () => activeLayerId && handleMoveLayer(activeLayerId, 'up'),
    moveLayerDown: () => activeLayerId && handleMoveLayer(activeLayerId, 'down'),
    hasActiveLayer: !!activeLayer && !activeLayer.isBackground,
    addTextLayer: () => setActiveTool('text'),
    centerTextInBubble: () => activeLayerId && handleCenterTextLayer(activeLayerId),
    hasActiveTextLayer: activeLayer?.type === 'text',
    panelTabs: allTabs.map(t => ({ id: t.id, label: t.label })),
    showPanel: (id) => dock.selectTab(id),
    isPanelVisible: (id) => dock.isFloating(id) || dock.activeTab.top === id || dock.activeTab.bottom === id,
    showShortcutsHelp: () => swal({
      title: 'Keyboard Shortcuts',
      html: `<div style="text-align:left;font-size:13px;line-height:1.8">${FIXED_SHORTCUTS_HELP.map(s => `<div><b>${s.keys}</b> — ${s.description}</div>`).join('')}</div>`,
    }),
    isFullscreen,
    toggleFullscreen,
    panelsHidden,
    togglePanelsHidden: () => setPanelsHidden(v => !v),
    showGrid,
    toggleGrid: () => setShowGrid(v => !v),
    showRulers,
    toggleRulers: () => setShowRulers(v => !v),
    hasSelection: hasSelection(selection),
    deselect: () => setSelection(NO_SELECTION),
    featherSelection: handleFeatherSelection,
    expandSelection: handleExpandSelection,
    contractSelection: handleContractSelection,
  });

  const [layoutMode, setLayoutMode] = useState<'desktop' | 'tablet' | 'phone'>(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
    if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
    return 'phone';
  });
  useEffect(() => {
    const mqDesktop = window.matchMedia('(min-width: 1024px)');
    const mqTablet = window.matchMedia('(min-width: 768px)');
    const onChange = () => setLayoutMode(mqDesktop.matches ? 'desktop' : mqTablet.matches ? 'tablet' : 'phone');
    mqDesktop.addEventListener('change', onChange);
    mqTablet.addEventListener('change', onChange);
    return () => {
      mqDesktop.removeEventListener('change', onChange);
      mqTablet.removeEventListener('change', onChange);
    };
  }, []);
  const isDesktop = layoutMode === 'desktop';

  const workflowStages = [
    { id: 'chapter', label: 'Chapter', active: true, tracked: true },
    { id: 'page', label: 'Page', active: !!activePage, tracked: true },
    { id: 'detection', label: 'Detection', active: false, tracked: false },
    { id: 'cleaning', label: 'Cleaning', active: !!activePage?.cleaned, tracked: true },
    { id: 'drawing', label: 'Drawing', active: layers.some(l => l.type === 'clean-patch'), tracked: true },
    { id: 'typesetting', label: 'Typesetting', active: layers.some(l => l.type === 'text' && !!l.text?.content), tracked: true },
    { id: 'review', label: 'Review', active: false, tracked: false },
    { id: 'export', label: 'Export', active: false, tracked: false },
  ];

  return (
    <div ref={studioRootRef} className="fixed inset-0 lg:relative lg:inset-auto studio-canvas-bg flex flex-col lg:rounded-panel lg:overflow-hidden lg:border lg:border-hairline lg:h-[calc(100vh-8.5rem)] z-30">
      {!panelsHidden && (
        <div className="hidden lg:block relative z-40">
          <MenuBar menus={menus} />
        </div>
      )}
      <StudioToolbar
        chapterName={chapterName}
        showCleaned={showCleaned}
        onToggleCleaned={() => setShowCleaned(v => !v)}
        overlayOpacity={overlayOpacity}
        onOverlayOpacityChange={setOverlayOpacity}
        onFit={() => setFitSignal(s => s + 1)}
        onBack={onBack}
        onToggleDock={() => setDockOpen(v => !v)}
        hasCleaned={!!activePage?.cleaned}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        workflowStages={workflowStages}
      />

      {!panelsHidden && (
        <ToolOptionsBar
          activeTool={activeTool}
          size={brushSize}
          onSizeChange={setBrushSize}
          hardness={brushHardness}
          onHardnessChange={setBrushHardness}
          opacity={brushOpacity}
          onOpacityChange={setBrushOpacity}
          flow={brushFlow}
          onFlowChange={setBrushFlow}
          tolerance={tolerance}
          onToleranceChange={setTolerance}
          liquifyMode={liquifyMode}
          onLiquifyModeChange={setLiquifyMode}
          symmetry={symmetry}
          onSymmetryChange={setSymmetry}
          spacing={spacing}
          onSpacingChange={setSpacing}
          brushShape={brushShape}
          onBrushShapeChange={setBrushShape}
          angle={brushAngle}
          onAngleChange={setBrushAngle}
          roundness={brushRoundness}
          onRoundnessChange={setBrushRoundness}
          scatter={scatter}
          onScatterChange={setScatter}
          smoothing={smoothing}
          onSmoothingChange={setSmoothing}
        />
      )}

      <div className="flex-1 flex min-h-0 flex-col-reverse lg:flex-row">
        {!panelsHidden && (
          <>
            <div className="lg:hidden relative z-40">
              <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="horizontal" />
            </div>
            <div className="hidden lg:block h-full relative z-40">
              <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="vertical" />
            </div>
          </>
        )}

        {/* Single shared canvas instance — desktop wraps it in a resizable split with the dock,
            tablet collapses the dock to a tap-to-open icon strip overlay, phone uses a bottom sheet. */}
        <div className="flex-1 min-h-0 min-w-0 relative">
          <PanelGroup direction="horizontal" autoSaveId={isDesktop && dockOpen && !panelsHidden ? DOCK_PANEL_GROUP_AUTOSAVE_ID : undefined}>
            <Panel minSize={30} defaultSize={75}>
              <StudioCanvas
                ref={canvasRef}
                page={activePage}
                showCleaned={showCleaned}
                overlayOpacity={overlayOpacity}
                showGrid={showGrid}
                showRulers={showRulers}
                activeTool={activeTool}
                fitSignal={fitSignal}
                layers={layers}
                activeLayerId={activeLayerId}
                onSelectLayer={selectLayer}
                onAddTextLayer={handleAddTextLayer}
                onUpdateTextLayer={handleUpdateTextLayer}
                paintSettings={paintSettings}
                selection={selection}
                onSelectionChange={setSelection}
                onPaintStrokeEnd={handlePaintStrokeEnd}
                onEyedropperPick={setForeground}
                onCommitCrop={handleCommitCrop}
                queuedBubbleRects={multiBubbleRects}
              />
            </Panel>
            {!panelsHidden && isDesktop && dockOpen && (
              <>
                <PanelResizeHandle className="w-1 bg-hairline hover:bg-accent/50 transition-colors" />
                <Panel minSize={16} defaultSize={25} maxSize={40}>
                  <PanelGroup direction="vertical" autoSaveId={`${DOCK_PANEL_GROUP_AUTOSAVE_ID}-v`}>
                    <Panel minSize={20} defaultSize={55}>
                      <RightDock
                        activeTab={dock.activeTab.top}
                        onTabChange={(id) => dock.setActiveTab('top', id)}
                        onFloatTab={dock.floatTab}
                        tabs={dockedTabs('top')}
                      />
                    </Panel>
                    <PanelResizeHandle className="h-1 bg-hairline hover:bg-accent/50 transition-colors" />
                    <Panel minSize={20} defaultSize={45}>
                      <RightDock
                        activeTab={dock.activeTab.bottom}
                        onTabChange={(id) => dock.setActiveTab('bottom', id)}
                        onFloatTab={dock.floatTab}
                        tabs={dockedTabs('bottom')}
                      />
                    </Panel>
                  </PanelGroup>
                </Panel>
              </>
            )}
          </PanelGroup>

          {!panelsHidden && layoutMode === 'tablet' && dockOpen && (
            <div className="absolute inset-y-0 right-0 z-20 flex">
              <div className="liquid-glass-bar w-12 shrink-0 border-l border-hairline flex flex-col items-center py-2 gap-1">
                {allTabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTabletOverlayTab(prev => prev === t.id ? null : t.id)}
                    title={t.label}
                    className={`w-11 h-11 rounded-control text-micro font-semibold flex items-center justify-center transition-colors ${
                      tabletOverlayTab === t.id ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink hover:bg-ink/5'
                    }`}
                  >
                    {t.label.slice(0, 2).toUpperCase()}
                  </button>
                ))}
              </div>
              {tabletOverlayTab && (
                <div ref={tabletOverlayRef} className="w-72 max-w-[75vw] h-full liquid-glass-heavy border-l border-hairline shadow-2xl">
                  {allTabs.find(t => t.id === tabletOverlayTab)?.content}
                </div>
              )}
            </div>
          )}

          {!panelsHidden && layoutMode === 'phone' && dockOpen && (
            <div className="absolute inset-x-0 bottom-0 top-[8vh] z-20 flex flex-col animate-slide-up-sheet">
              <button
                aria-label="Close panel"
                onClick={() => setDockOpen(false)}
                className="h-6 shrink-0 flex items-center justify-center liquid-glass-bar !bg-transparent border-x border-t border-hairline rounded-t-2xl"
              >
                <span className="w-10 h-1 rounded-full bg-ink/20" />
              </button>
              <div className="flex-1 min-h-0">
                <RightDock
                  activeTab={dock.activeTab.bottom}
                  onTabChange={(id) => dock.setActiveTab('bottom', id)}
                  className="!w-full !h-full !border-l-0 border-x border-hairline"
                  tabs={mobileTabs}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {!panelsHidden && Object.entries(dock.floating).map(([tabId, rect]) => {
        const tab = allTabs.find(t => t.id === tabId);
        if (!tab) return null;
        return (
          <FloatingPanel
            key={tabId}
            label={tab.label}
            rect={rect}
            onRectChange={(r) => dock.updateFloatingRect(tabId, r)}
            onDockBack={() => dock.dockBack(tabId)}
          >
            {tab.content}
          </FloatingPanel>
        );
      })}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        fileBaseName={`${chapterName}${activePage ? `_${activePage.original.filename.replace(/\.[^.]+$/, '')}` : ''}`.replace(/\s+/g, '_')}
        getSnapshot={() => canvasRef.current?.getExportSnapshot() ?? null}
        exportPsd={exportPsd}
      />
    </div>
  );
}
