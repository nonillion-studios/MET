import { useMemo } from 'react';
import { Group, Rect, Line, Ellipse, Text as KonvaText } from 'react-konva';
import type Konva from 'konva';
import type { StudioLayer, TextLayerData, LayerSelectMode } from './studioTypes';
import { layoutText } from './textLayout';
import { gradientVector } from './textGradient';

interface TextLayerNodeProps {
  layer: StudioLayer;
  groupRef: (node: Konva.Group | null) => void;
  editing: boolean;
  selected: boolean;
  draggable: boolean;
  onSelect: (mode: LayerSelectMode) => void;
  onEdit: () => void;
  onUpdate: (patch: Partial<TextLayerData>) => void;
  /** Click a wrapped line (while selected, not editing) to apply per-line style overrides to it —
   *  independent of the character-range selection the editing textarea drives. */
  onSelectLine?: (lineIndex: number) => void;
}

/**
 * Konva name on a text layer's invisible hit rect. The stage's "did I click empty canvas?" test goes
 * by class name, and the page's drop-shadow backing is a Rect too — so without a name to tell them
 * apart, clicking text reads as clicking background and clears the selection it just made.
 */
export const TEXT_HIT_NAME = 'text-hit';

/** Shift or Ctrl/Cmd adds to (or removes from) the selection; a plain click replaces it. */
function selectModeFor(evt: MouseEvent | TouchEvent): LayerSelectMode {
  const e = evt as MouseEvent;
  return e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
}

/**
 * A text layer on the Konva stage.
 *
 * Konva has no rich text — `Konva.Text` renders one uniform style — so per-character runs mean we
 * own line-breaking and positioning (`textLayout.ts`) and render **one Konva.Text per positioned
 * run** inside a Group. Konva still paints the glyphs; we only place them. A custom `sceneFunc`
 * would have meant reimplementing stroke/shadow/gradient painting from scratch.
 *
 * The Group is the interactive/transform target; the run nodes are inert.
 */
export function TextLayerNode({
  layer, groupRef, editing, selected, draggable, onSelect, onEdit, onUpdate, onSelectLine,
}: TextLayerNodeProps) {
  const text = layer.text!;
  const layout = useMemo(() => layoutText(text), [text]);

  const gradient = text.gradient?.enabled ? text.gradient : null;
  // One ramp across the whole layer, not one per run: the vector is computed on the layout box and
  // each run subtracts its own offset, because Konva gradient points are node-local. Without that
  // subtraction every run would restart the ramp.
  const ramp = gradient ? gradientVector(layout.width, layout.height, gradient.angle) : null;

  // Type Region: clips the whole node to the shape the container was created from, in the Group's
  // own local space (its clipShape is stored in the same image-space coords as text.x/y, so each
  // point is offset back by them). Konva's clipFunc runs on every draw, so this stays correct as
  // the layer moves — nothing needs to re-translate the stored shape itself.
  const clip = text.clipShape;
  const clipFunc = useMemo(() => {
    if (!clip) return undefined;
    return (ctx: Konva.Context) => {
      ctx.beginPath();
      if (clip.kind === 'ellipse') {
        const cx = clip.x + clip.width / 2 - text.x;
        const cy = clip.y + clip.height / 2 - text.y;
        ctx.ellipse(cx, cy, Math.abs(clip.width) / 2, Math.abs(clip.height) / 2, 0, 0, Math.PI * 2);
      } else {
        clip.points.forEach((p, i) => {
          const lx = p.x - text.x, ly = p.y - text.y;
          if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
        });
      }
      ctx.closePath();
    };
  }, [clip, text.x, text.y]);

  return (
    <>
    <Group
      ref={groupRef}
      visible={!editing}
      clipFunc={clipFunc}
      x={text.x}
      y={text.y}
      rotation={text.rotation}
      draggable={draggable}
      onClick={(e) => onSelect(selectModeFor(e.evt))}
      onTap={(e) => onSelect(selectModeFor(e.evt))}
      onDblClick={onEdit}
      onDblTap={onEdit}
      // Stops the browser's own touch-scroll/gesture handling from fighting a text drag on touch
      // devices — Konva's own drag machinery (document-level move/up listeners) already takes care
      // of tracking the pointer past the node's bounds, so nothing else is needed here.
      onDragStart={(e) => e.evt?.preventDefault?.()}
      // Konva's Transformer already moves every attached node when a multi-selection is dragged, so
      // each node just commits its own final position — propagating the delta by hand here would
      // double-apply it and the followers would overshoot.
      onDragEnd={(e) => onUpdate({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Group;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        // Scale must not stay baked on the node — it's converted into width/fontSize instead, so
        // the next layout starts from a clean transform.
        node.scaleX(1);
        node.scaleY(1);
        onUpdate({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          width: Math.max(20, layout.width * scaleX),
          fontSize: Math.max(6, text.fontSize * scaleY),
        });
      }}
    >
      {/* Hit area + the Group's bounds, so clicking gaps between glyphs still selects the layer and
          the Transformer frames the text box rather than the glyph extents. A `transparent` fill is
          still drawn to the hit canvas (Konva substitutes its own colour key there), so this is
          invisible but clickable. */}
      <Rect name={TEXT_HIT_NAME} width={Math.max(layout.width, 4)} height={Math.max(layout.height, 4)} fill="transparent" />

      {layout.runs.map((run, i) => (
        <KonvaText
          key={i}
          x={run.x}
          y={run.y}
          text={run.text}
          fontFamily={run.style.fontFamily}
          fontSize={run.style.fontSize}
          fontStyle={`${run.style.italic ? 'italic ' : ''}${run.style.fontWeight}`}
          letterSpacing={run.style.letterSpacing}
          // Already laid out: one line, no wrapping, no alignment box.
          wrap="none"
          lineHeight={1}
          fill={run.style.color}
          fillPriority={gradient ? 'linear-gradient' : 'color'}
          fillLinearGradientColorStops={gradient ? [0, gradient.from, 1, gradient.to] : undefined}
          fillLinearGradientStartPoint={ramp ? { x: ramp.start.x - run.x, y: ramp.start.y - run.y } : undefined}
          fillLinearGradientEndPoint={ramp ? { x: ramp.end.x - run.x, y: ramp.end.y - run.y } : undefined}
          shadowEnabled={text.shadow?.enabled ?? false}
          shadowColor={text.shadow?.color}
          shadowBlur={text.shadow?.blur}
          shadowOffsetX={text.shadow?.offsetX}
          shadowOffsetY={text.shadow?.offsetY}
          stroke={text.strokeWidth > 0 ? text.strokeColor : undefined}
          strokeWidth={text.strokeWidth}
          listening={false}
        />
      ))}

      {selected && !editing && (
        <Line
          points={[0, layout.firstBaselineY, Math.max(layout.width, 4), layout.firstBaselineY]}
          stroke="#38bdf8"
          strokeWidth={1}
          dash={[4, 3]}
          opacity={0.7}
          listening={false}
        />
      )}

      {/* Per-line hit targets — only while selected and not mid-edit, so they never fight the
          editing textarea's own character-range selection or the Group's own drag/select click. */}
      {selected && !editing && onSelectLine && layout.lines.map((line, i) => (
        <Rect
          key={i}
          y={line.y}
          width={Math.max(layout.width, 4)}
          height={line.height}
          fill="transparent"
          onClick={(e) => { e.cancelBubble = true; onSelectLine(i); }}
          onTap={(e) => { e.cancelBubble = true; onSelectLine(i); }}
        />
      ))}

      {/* Overflow indicator for a fixed-height area frame — laid-out content exceeds it, so some
          lines are being clipped rather than silently lost off-frame. */}
      {layout.overflowing && (
        <KonvaText
          text="⊞"
          x={Math.max(layout.width, 4) - 16}
          y={(text.fixedHeight ?? layout.height) - 16}
          fontSize={14}
          fill="#f59e0b"
          listening={false}
        />
      )}
    </Group>

    {/* Type Region's own shape outline. A sibling of the main Group (not a child of it) since that
        Group hides entirely while editing — the outline is exactly what needs to stay visible then,
        so the container's real shape is still readable on canvas behind the editing textarea. Shown
        while editing, hidden once the layer is deselected entirely. */}
    {clip && (editing || selected) && (
      <Group x={text.x} y={text.y} rotation={text.rotation} listening={false}>
        {clip.kind === 'ellipse' ? (
          <Ellipse
            x={clip.x + clip.width / 2 - text.x}
            y={clip.y + clip.height / 2 - text.y}
            radiusX={Math.abs(clip.width) / 2}
            radiusY={Math.abs(clip.height) / 2}
            stroke="#f59e0b"
            strokeWidth={1}
            dash={[5, 4]}
          />
        ) : (
          <Line
            points={clip.points.flatMap(p => [p.x - text.x, p.y - text.y])}
            closed
            stroke="#f59e0b"
            strokeWidth={1}
            dash={[5, 4]}
          />
        )}
      </Group>
    )}
    </>
  );
}
