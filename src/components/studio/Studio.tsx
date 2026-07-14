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
import { NO_SELECTION, type Selection } from './paint/selection';
import type { PaintSettings } from './paint/paintEngine';
import { ToolOptionsBar } from './toolOptions/ToolOptionsBar';
import { useStudioShortcuts } from './shortcuts/useStudioShortcuts';
import { FIXED_SHORTCUTS_HELP } from './shortcuts/shortcutsMap';
import { MenuBar } from './menu/MenuBar';
import { buildMenus } from './menu/menuDefinitions';
import { swal } from '../../lib/swalTheme';
import {
  createBackgroundLayer, createLayer, createTextLayer, parseTyperScript,
  DEFAULT_TYPER_STYLES, type StudioLayer, type TextLayerData, type TyperStyle,
} from './studioTypes';

interface StudioProps {
  chapterName: string;
  pages: Page[];
  onBack: () => void;
}

export function Studio(props: StudioProps) {
  return (
    <ColorProvider>
      <HistoryProvider>
        <DockProvider>
          <StudioInner {...props} />
        </DockProvider>
      </HistoryProvider>
    </ColorProvider>
  );
}

function StudioInner({ chapterName, pages, onBack }: StudioProps) {
  const canvasRef = useRef<StudioCanvasHandle>(null);
  const { foreground, setForeground, swap: swapColors, reset: resetColors } = useColor();
  const history = useHistory();
  useKeyboardUndo();
  const dock = useDock();
  const [brushSize, setBrushSize] = useState(24);
  const [brushHardness, setBrushHardness] = useState(0.8);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushFlow, setBrushFlow] = useState(1);
  const [tolerance, setTolerance] = useState(32);
  const paintSettings: PaintSettings = { size: brushSize, hardness: brushHardness, opacity: brushOpacity, flow: brushFlow, color: foreground, tolerance };
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);

  useStudioShortcuts({
    onToolChange: (id) => setActiveTool(id),
    onBrushSizeStep: (delta) => setBrushSize(v => Math.max(1, Math.min(200, v + delta))),
    onSwapColors: swapColors,
    onResetColors: resetColors,
    onZoomIn: () => canvasRef.current?.zoomIn(),
    onZoomOut: () => canvasRef.current?.zoomOut(),
    onFit: () => setFitSignal(s => s + 1),
    onToggleCleaned: () => setShowCleaned(v => !v),
  });
  const [activePageId, setActivePageId] = useState<string | null>(pages[0]?.id ?? null);
  const [activeTool, setActiveTool] = useState('select');
  const [showCleaned, setShowCleaned] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const [dockOpen, setDockOpen] = useState(true);

  // Per-page layer stacks. Each page always has a locked "Background" layer at index 0.
  const [layersByPage, setLayersByPage] = useState<Record<string, StudioLayer[]>>({});
  const [activeLayerId, setActiveLayerId] = useState<string | null>('background');

  // TypeR: scripted lettering — paste a script, arm it, click bubbles to stamp lines in order.
  const [typerScript, setTyperScript] = useState('');
  const [typerStyles, setTyperStyles] = useState<TyperStyle[]>(DEFAULT_TYPER_STYLES);
  const [typerIndex, setTyperIndex] = useState(0);
  const [typerArmed, setTyperArmed] = useState(false);
  const typerLines = useMemo(() => parseTyperScript(typerScript, typerStyles), [typerScript, typerStyles]);

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

  function updateLayers(updater: (current: StudioLayer[]) => StudioLayer[], historyLabel?: string) {
    if (!activePageId) return;
    const pageId = activePageId;
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

  function handleAddLayer() {
    const layer = createLayer('clean-patch', `Layer ${layers.length}`);
    updateLayers(current => [...current, layer], 'Add Layer');
    setActiveLayerId(layer.id);
  }

  function selectLayer(id: string) {
    setActiveLayerId(id);
    if (layers.find(l => l.id === id)?.type === 'text') dock.selectTab('text');
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

  function handleAddTextLayer(x: number, y: number) {
    const layer = createTextLayer(x, y);

    if (typerArmed && typerLines[typerIndex]) {
      const { content, style } = typerLines[typerIndex];
      layer.name = `Text: ${content.slice(0, 20)}`;
      layer.text = {
        ...layer.text!,
        content,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        bold: style.bold,
        italic: style.italic,
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

  function handleCenterTextLayer(id: string) {
    canvasRef.current?.centerTextLayerInBubble(id);
  }

  const activeLayer = layers.find(l => l.id === activeLayerId) ?? null;

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
      onDuplicate={handleDuplicateLayer}
      onDelete={handleDeleteLayer}
      onMove={handleMoveLayer}
    />
  );

  const pagesPanel = (
    <StudioPagesPanel pages={pages} activePageId={activePageId} onSelect={setActivePageId} orientation="vertical" />
  );

  const textPanel = activeLayer?.type === 'text' ? (
    <TextPanel layer={activeLayer} onUpdate={handleUpdateTextLayer} onCenter={handleCenterTextLayer} />
  ) : null;

  const colorPanel = <ColorPanel />;
  const historyPanel = <HistoryPanel />;

  const typerPanel = (
    <TyperPanel
      script={typerScript}
      onScriptChange={setTyperScript}
      styles={typerStyles}
      onStylesChange={setTyperStyles}
      index={typerIndex}
      onIndexChange={setTyperIndex}
      armed={typerArmed}
      onArmedChange={(armed) => { setTyperArmed(armed); if (armed) setActiveTool('text'); }}
    />
  );

  const allTabs = [
    ...(textPanel ? [{ id: 'text', label: 'Text', content: textPanel }] : []),
    { id: 'typer', label: 'TypeR', content: typerPanel },
    { id: 'color', label: 'Color', content: colorPanel },
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
    showShortcutsHelp: () => swal({
      title: 'Keyboard Shortcuts',
      html: `<div style="text-align:left;font-size:13px;line-height:1.8">${FIXED_SHORTCUTS_HELP.map(s => `<div><b>${s.keys}</b> — ${s.description}</div>`).join('')}</div>`,
    }),
  });

  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="fixed inset-0 lg:relative lg:inset-auto flex flex-col bg-[#0b0b0d] lg:rounded-2xl lg:overflow-hidden lg:border lg:border-hairline lg:h-[calc(100vh-8.5rem)] z-30">
      <div className="hidden lg:block relative z-40">
        <MenuBar menus={menus} />
      </div>
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
      />

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
      />

      <div className="flex-1 flex min-h-0 flex-col-reverse lg:flex-row">
        <div className="lg:hidden relative z-40">
          <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="horizontal" />
        </div>
        <div className="hidden lg:block h-full relative z-40">
          <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="vertical" />
        </div>

        {/* Single shared canvas instance — desktop wraps it in a resizable split with the dock, mobile overlays the dock as a bottom sheet. */}
        <div className="flex-1 min-h-0 min-w-0 relative">
          <PanelGroup direction="horizontal" autoSaveId={isDesktop && dockOpen ? DOCK_PANEL_GROUP_AUTOSAVE_ID : undefined}>
            <Panel minSize={30} defaultSize={75}>
              <StudioCanvas
                ref={canvasRef}
                page={activePage}
                showCleaned={showCleaned}
                overlayOpacity={overlayOpacity}
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
              />
            </Panel>
            {isDesktop && dockOpen && (
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

          {!isDesktop && dockOpen && (
            <div className="absolute inset-x-0 bottom-0 h-[45vh] z-10">
              <RightDock
                activeTab={dock.activeTab.bottom}
                onTabChange={(id) => dock.setActiveTab('bottom', id)}
                className="!w-full !border-l-0 border-t border-hairline rounded-t-2xl"
                tabs={mobileTabs}
              />
            </div>
          )}
        </div>
      </div>

      {Object.entries(dock.floating).map(([tabId, rect]) => {
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
    </div>
  );
}
