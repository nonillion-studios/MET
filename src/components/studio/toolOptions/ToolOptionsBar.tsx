import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Check, X, Wand2 } from 'lucide-react';
import { findTool } from '../toolGroups';
import type { LiquifyMode, SymmetryMode } from '../paint/paintEngine';
import type { BrushShape } from '../paint/brushTip';
import type { ContentAwareMode } from '../paint/contentAwareAlgorithms';
import { PAINT_TOOLS } from '../paint/usePaintLayer';
import type { SampleMode } from '../../../lib/sampleComposite';
import type { TextLayerData, TextAlign } from '../studioTypes';
import type { TextSelection } from '../StudioCanvas';
import { resolveCharValue, applyCharPatch, type ResolvedRunStyle, type RunStylePatch } from '../textRuns';

/** The text tool's "no layer placed yet" defaults — what the *next* text layer will be created
 *  with. Lives in Studio.tsx (`pendingTextDefaults`) since it needs to survive across a tool
 *  selection and feed `handleAddTextLayer`, not just this bar's own local state. */
export interface PendingTextDefaults {
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  bold: boolean;
  italic: boolean;
}

interface ToolOptionsBarProps {
  layoutMode?: 'desktop' | 'tablet' | 'phone';
  activeTool: string;
  size: number;
  onSizeChange: (v: number) => void;
  hardness: number;
  onHardnessChange: (v: number) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  flow: number;
  onFlowChange: (v: number) => void;
  tolerance: number;
  onToleranceChange: (v: number) => void;
  liquifyMode: LiquifyMode;
  onLiquifyModeChange: (v: LiquifyMode) => void;
  symmetry: SymmetryMode;
  onSymmetryChange: (v: SymmetryMode) => void;
  spacing: number;
  onSpacingChange: (v: number) => void;
  brushShape: BrushShape | 'image';
  onBrushShapeChange: (v: BrushShape) => void;
  angle: number;
  onAngleChange: (v: number) => void;
  roundness: number;
  onRoundnessChange: (v: number) => void;
  scatter: number;
  onScatterChange: (v: number) => void;
  smoothing: number;
  onSmoothingChange: (v: number) => void;
  contentAwareMode: ContentAwareMode;
  onContentAwareModeChange: (v: ContentAwareMode) => void;
  sampleMode: SampleMode;
  onSampleModeChange: (v: SampleMode) => void;
  sliceRectCount: number;
  onAddSliceRect: () => void;
  onExportSlices: () => void;
  hasSelection: boolean;
  onDeselect: () => void;
  /** The active layer's text data, only when it's actually a text layer — null whenever the Text
   *  tool is active but nothing is placed/selected yet, in which case the bar falls back to
   *  `pendingTextDefaults` (what the *next* placed text layer will use). */
  activeText?: TextLayerData | null;
  activeTextLayerId?: string | null;
  /** Character range selected inside the editing textarea — same shape TextPanel's own range-aware
   *  controls key off, so a real selection restyles only those characters here too. */
  textSelection?: TextSelection | null;
  onUpdateText?: (id: string, patch: Partial<TextLayerData>, historyLabel?: string) => void;
  pendingTextDefaults?: PendingTextDefaults;
  onUpdatePendingTextDefaults?: (patch: Partial<PendingTextDefaults>) => void;
  fontFamilies?: string[];
  onOpenWarpText?: () => void;
  /** Whether the active text layer is currently being edited (textarea focused) — only then do the
   *  ✓/✗ commit/cancel buttons show. */
  isEditingActiveText?: boolean;
  onCommitTextEdit?: () => void;
  onCancelTextEdit?: () => void;
}

const DEFAULT_FONT_FAMILIES = ['Arial', 'Georgia', 'Times New Roman'];
const FONT_STYLE_OPTIONS: { id: string; label: string; bold: boolean; italic: boolean }[] = [
  { id: 'regular', label: 'Regular', bold: false, italic: false },
  { id: 'bold', label: 'Bold', bold: true, italic: false },
  { id: 'italic', label: 'Italic', bold: false, italic: true },
  { id: 'bold-italic', label: 'Bold Italic', bold: true, italic: true },
];

const SIZE_TOOLS = new Set(['brush', 'pencil', 'eraser', 'clone', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'spot-heal', 'shape-rect', 'shape-ellipse', 'shape-line', 'liquify']);
const HARDNESS_TOOLS = new Set(['brush', 'clone', 'heal']);
const FLOW_TOOLS = new Set(['brush', 'pencil', 'eraser', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'liquify']);
const OPACITY_TOOLS = new Set(['brush', 'pencil', 'eraser', 'bucket', 'gradient']);
const TOLERANCE_TOOLS = new Set(['wand', 'bucket']);
const SYMMETRY_TOOLS = new Set(['brush', 'pencil', 'eraser']);
const SELECTION_TOOLS = new Set(['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'lasso-freehand', 'lasso-polygon', 'lasso-magnetic', 'wand']);
const CONTENT_AWARE_TOOLS = new Set(['spot-heal', 'contentAware']);
/** Clone/Heal source and the Eyedropper both read pixels through the same `sampleMode` — matches
 *  Photoshop's single shared "Sample" setting rather than a per-tool copy. */
const SAMPLE_TOOLS = new Set(['clone', 'heal', 'eyedropper']);

const LIQUIFY_MODES: { id: LiquifyMode; label: string }[] = [
  { id: 'push', label: 'Push' },
  { id: 'swirl', label: 'Swirl' },
  { id: 'pinch', label: 'Pinch' },
  { id: 'bloat', label: 'Bloat' },
  { id: 'crystalize', label: 'Crystalize' },
  { id: 'reconstruct', label: 'Reconstruct' },
];

const BRUSH_SHAPES: { id: BrushShape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
];

const SYMMETRY_MODES: { id: SymmetryMode; label: string }[] = [
  { id: 'none', label: 'Off' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'both', label: 'Both' },
];

const CONTENT_AWARE_MODES: { id: ContentAwareMode; label: string }[] = [
  { id: 'proximity', label: 'Proximity Match' },
  { id: 'texture', label: 'Create Texture' },
  { id: 'contentAware', label: 'Content-Aware' },
];

const SAMPLE_MODES: { id: SampleMode; label: string }[] = [
  { id: 'current', label: 'Current Layer' },
  { id: 'currentBelow', label: 'Current & Below' },
  { id: 'all', label: 'All Layers' },
  { id: 'allNoAdj', label: 'All Layers no Adjustments' },
  { id: 'currentBelowNoAdj', label: 'Current & Below no Adjustments' },
];

function Slider({ label, value, min, max, step, onChange, format, phone }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; phone?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
      <span className="uppercase tracking-wide text-[10px] opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`studio-focusable accent-[var(--color-accent)] ${phone ? 'w-24 h-6' : 'w-20'}`}
      />
      <span className="w-8 text-right tabular-nums text-ink font-mono text-[10px]">{format ? format(value) : Math.round(value)}</span>
    </label>
  );
}

export function ToolOptionsBar({
  layoutMode = 'desktop',
  activeTool, size, onSizeChange, hardness, onHardnessChange, opacity, onOpacityChange,
  flow, onFlowChange, tolerance, onToleranceChange, liquifyMode, onLiquifyModeChange,
  symmetry, onSymmetryChange, spacing, onSpacingChange, brushShape, onBrushShapeChange,
  angle, onAngleChange, roundness, onRoundnessChange, scatter, onScatterChange,
  smoothing, onSmoothingChange,
  contentAwareMode, onContentAwareModeChange,
  sampleMode, onSampleModeChange,
  sliceRectCount, onAddSliceRect, onExportSlices,
  hasSelection, onDeselect,
  activeText = null, activeTextLayerId = null, textSelection = null, onUpdateText,
  pendingTextDefaults, onUpdatePendingTextDefaults, fontFamilies = DEFAULT_FONT_FAMILIES,
  onOpenWarpText, isEditingActiveText = false, onCommitTextEdit, onCancelTextEdit,
}: ToolOptionsBarProps) {
  const phone = layoutMode === 'phone';
  const tool = findTool(activeTool);
  const showSize = SIZE_TOOLS.has(activeTool);
  const showHardness = HARDNESS_TOOLS.has(activeTool);
  const showFlow = FLOW_TOOLS.has(activeTool);
  const showOpacity = OPACITY_TOOLS.has(activeTool);
  const showTolerance = TOLERANCE_TOOLS.has(activeTool);
  const showLiquifyMode = activeTool === 'liquify';
  const showSymmetry = SYMMETRY_TOOLS.has(activeTool);
  const showContentAwareMode = CONTENT_AWARE_TOOLS.has(activeTool);
  const showSlice = activeTool === 'slice';
  const showDeselect = SELECTION_TOOLS.has(activeTool) && hasSelection;
  const showSelectionHint = (PAINT_TOOLS as readonly string[]).includes(activeTool) && hasSelection;
  const showSample = SAMPLE_TOOLS.has(activeTool);
  // Placing a text layer immediately switches the active tool back to 'select' while the layer
  // stays selected (see Studio.tsx's handleAddTextLayer) — so the bar has to stay up whenever the
  // *active layer* is text, not just while the Text tool itself is armed. Deliberately NOT keyed on
  // `isEditingActiveText` (which clears on the editing textarea's blur): a click on any button in
  // this bar blurs that textarea on its way to registering, so a visibility condition that drops
  // the instant blur fires would remove the bar out from under its own click before the click
  // handler ever runs — a real bug this exact shape caught in testing, not a hypothetical.
  const showText = activeTool === 'text' || activeText != null;

  if (!tool || (!showSize && !showHardness && !showFlow && !showOpacity && !showTolerance && !showLiquifyMode && !showSymmetry && !showContentAwareMode && !showSlice && !showDeselect && !showSelectionHint && !showSample && !showText)) return null;

  // Range-aware character controls when a real text layer is active (mirrors TextPanel.tsx exactly,
  // so the two can't disagree about what a selected range's "shared value" is) — falls back to the
  // pending-new-text defaults when the Text tool is armed but nothing is placed/selected yet.
  const range = activeText && textSelection && textSelection.layerId === activeTextLayerId && textSelection.end > textSelection.start
    ? textSelection
    : null;
  const charValue = activeText
    ? <K extends keyof ResolvedRunStyle>(key: K) => resolveCharValue(activeText, range, key)
    : null;
  const setChar = activeText && activeTextLayerId && onUpdateText
    ? (patch: RunStylePatch) => onUpdateText(activeTextLayerId, applyCharPatch(activeText, range, patch))
    : null;
  const textAlign: TextAlign = activeText ? activeText.align : (pendingTextDefaults?.align ?? 'center');
  const textFontFamily = activeText ? charValue!('fontFamily') : (pendingTextDefaults?.fontFamily ?? fontFamilies[0]);
  const textFontSize = activeText ? charValue!('fontSize') : (pendingTextDefaults?.fontSize ?? 28);
  const textColor = activeText ? charValue!('color') : (pendingTextDefaults?.color ?? '#000000');
  const textBold = activeText ? charValue!('fontWeight') >= 600 : (pendingTextDefaults?.bold ?? false);
  const textItalic = activeText ? charValue!('italic') : (pendingTextDefaults?.italic ?? false);
  const currentFontStyleId = textBold && textItalic ? 'bold-italic' : textBold ? 'bold' : textItalic ? 'italic' : 'regular';

  function setTextField<K extends 'fontFamily' | 'fontSize' | 'color'>(key: K, value: string | number) {
    if (setChar) setChar({ [key]: value } as RunStylePatch);
    else onUpdatePendingTextDefaults?.({ [key]: value } as Partial<PendingTextDefaults>);
  }
  function setTextStyle(id: string) {
    const opt = FONT_STYLE_OPTIONS.find(o => o.id === id) ?? FONT_STYLE_OPTIONS[0];
    if (setChar) setChar({ bold: opt.bold, italic: opt.italic, fontWeight: undefined });
    else onUpdatePendingTextDefaults?.({ bold: opt.bold, italic: opt.italic });
  }
  function setTextAlign(id: TextAlign) {
    if (activeText && activeTextLayerId && onUpdateText) onUpdateText(activeTextLayerId, { align: id });
    else onUpdatePendingTextDefaults?.({ align: id });
  }

  const controlClass = `studio-interactive studio-focusable bg-ink/5 border border-hairline rounded-control text-ink text-micro shrink-0 ${phone ? 'min-h-11 px-3' : 'px-2 py-1'}`;
  const selectClass = `bg-ink/5 border border-hairline rounded-control text-ink text-micro ${phone ? 'min-h-11 px-2' : 'px-1.5 py-1'}`;

  return (
    <div className={`liquid-glass-bar flex items-center gap-4 px-3 shrink-0 border-b border-hairline overflow-x-auto ${phone ? 'min-h-14' : 'h-10'}`}>
      <span className="text-ui font-medium text-ink shrink-0 min-w-[5.5rem]">{tool.label}</span>
      <div className="w-px h-4 bg-hairline shrink-0" />
      {showLiquifyMode && (
        <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
          <span>Mode</span>
          <select
            value={liquifyMode}
            onChange={(e) => onLiquifyModeChange(e.target.value as LiquifyMode)}
            className={selectClass}
          >
            {LIQUIFY_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      )}
      {showContentAwareMode && (
        <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
          <span>Mode</span>
          <select
            value={contentAwareMode}
            onChange={(e) => onContentAwareModeChange(e.target.value as ContentAwareMode)}
            className={selectClass}
          >
            {CONTENT_AWARE_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      )}
      {showDeselect && (
        <button
          className={controlClass}
          onClick={onDeselect}
        >
          Deselect
        </button>
      )}
      {showSelectionHint && (
        <span className="text-micro text-ink-faint shrink-0 whitespace-nowrap">
          Editing inside selection — Ctrl+D to deselect
        </span>
      )}
      {showSize && <Slider label="Size" value={size} min={1} max={200} step={1} onChange={onSizeChange} phone={phone} />}
      {showHardness && <Slider label="Hardness" value={hardness * 100} min={0} max={100} step={1} onChange={(v) => onHardnessChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />}
      {showFlow && <Slider label="Flow" value={flow * 100} min={0} max={100} step={1} onChange={(v) => onFlowChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />}
      {showOpacity && <Slider label="Opacity" value={opacity * 100} min={0} max={100} step={1} onChange={(v) => onOpacityChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />}
      {showTolerance && <Slider label="Tolerance" value={tolerance} min={0} max={100} step={1} onChange={onToleranceChange} phone={phone} />}
      {showSample && (
        <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
          <span className="uppercase tracking-wide text-[10px] opacity-70">Sample</span>
          <select
            value={sampleMode}
            onChange={(e) => onSampleModeChange(e.target.value as SampleMode)}
            className={`studio-interactive studio-focusable ${selectClass}`}
          >
            {SAMPLE_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      )}
      {showSlice && (
        <>
          <button
            className={controlClass}
            onClick={onAddSliceRect}
          >
            Add Rect ({sliceRectCount})
          </button>
          <button
            className={`${controlClass} disabled:opacity-40 disabled:cursor-not-allowed`}
            onClick={onExportSlices}
            disabled={sliceRectCount === 0}
          >
            Export Slices…
          </button>
        </>
      )}
      {showSymmetry && (
        <>
          <Slider label="Spacing" value={spacing * 100} min={1} max={100} step={1} onChange={(v) => onSpacingChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <Slider label="Smoothing" value={smoothing * 100} min={0} max={100} step={1} onChange={(v) => onSmoothingChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <Slider label="Scatter" value={scatter * 100} min={0} max={100} step={1} onChange={(v) => onScatterChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <Slider label="Angle" value={angle} min={-180} max={180} step={1} onChange={onAngleChange} format={(v) => `${Math.round(v)}°`} phone={phone} />
          <Slider label="Round" value={roundness * 100} min={5} max={100} step={1} onChange={(v) => onRoundnessChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Tip</span>
            <select
              value={brushShape}
              onChange={(e) => onBrushShapeChange(e.target.value as BrushShape)}
              className={`studio-interactive studio-focusable ${selectClass}`}
            >
              {/* 'Image' only appears while an imported tip is active — picking a
                  procedural shape here is how you switch back off it. */}
              {brushShape === 'image' && <option value="image">Image</option>}
              {BRUSH_SHAPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Symmetry</span>
            <select
              value={symmetry}
              onChange={(e) => onSymmetryChange(e.target.value as SymmetryMode)}
              className={`studio-interactive studio-focusable ${selectClass}`}
            >
              {SYMMETRY_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </>
      )}
      {showText && (
        <>
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Font</span>
            <select
              value={textFontFamily}
              onChange={(e) => setTextField('fontFamily', e.target.value)}
              className={`studio-interactive studio-focusable ${selectClass}`}
            >
              {fontFamilies.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Style</span>
            <select
              value={currentFontStyleId}
              onChange={(e) => setTextStyle(e.target.value)}
              className={`studio-interactive studio-focusable ${selectClass}`}
            >
              {FONT_STYLE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Size</span>
            <input
              type="number"
              min={1}
              max={999}
              value={Math.round(textFontSize)}
              onChange={(e) => setTextField('fontSize', Number(e.target.value) || textFontSize)}
              className={`w-14 ${controlClass}`}
            />
          </label>
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Color</span>
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextField('color', e.target.value)}
              className="w-7 h-7 rounded-control border border-hairline bg-transparent shrink-0"
            />
          </label>
          <div className="flex items-center gap-1 shrink-0">
            {([
              { id: 'left', icon: AlignLeft },
              { id: 'center', icon: AlignCenter },
              { id: 'right', icon: AlignRight },
              { id: 'justify', icon: AlignJustify },
            ] as { id: TextAlign; icon: typeof AlignLeft }[]).map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={`Align ${id}`}
                onClick={() => setTextAlign(id)}
                className={`studio-interactive studio-focusable w-7 h-7 flex items-center justify-center rounded-control border ${
                  textAlign === id ? 'bg-accent-soft text-accent border-accent/40' : 'border-hairline text-ink hover:bg-ink/5'
                }`}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          {onOpenWarpText && (
            <button
              type="button"
              aria-label="Warp Text"
              title="Warp Text…"
              onClick={onOpenWarpText}
              disabled={!activeText}
              className={`${controlClass} disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center`}
            >
              <Wand2 size={14} />
            </button>
          )}
          {isEditingActiveText && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label="Commit text edit"
                title="Commit"
                onClick={onCommitTextEdit}
                className={`${controlClass} !text-emerald-500 flex items-center justify-center`}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                aria-label="Cancel text edit"
                title="Cancel"
                onClick={onCancelTextEdit}
                className={`${controlClass} !text-red-400 flex items-center justify-center`}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
