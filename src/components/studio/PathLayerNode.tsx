import { Group, Shape, Rect, Ellipse, Line } from 'react-konva';
import type Konva from 'konva';
import type { StudioLayer, PathLayerData, PathAnchor, LayerSelectMode } from './studioTypes';
import { traceAnchors, toggleAnchorType } from './pathGeometry';

interface PathLayerNodeProps {
  layer: StudioLayer;
  groupRef: (node: Konva.Group | null) => void;
  selected: boolean;
  draggable: boolean;
  /** Direct Selection is active — render per-anchor/per-handle chrome instead of (or alongside)
   *  the plain selection outline, only for the currently selected path layer. */
  directSelect: boolean;
  onSelect: (mode: LayerSelectMode) => void;
  onUpdate: (patch: Partial<PathLayerData>) => void;
}

function selectModeFor(evt: MouseEvent | TouchEvent): LayerSelectMode {
  const e = evt as MouseEvent;
  return e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
}

/**
 * A vector path layer on the Konva stage. Unlike `TextLayerNode`, this Group has no persistent
 * `x`/`y` — a path's geometry has no single position field, it's the anchor points themselves
 * (each already in absolute page-pixel coordinates). The Group always renders at (0,0); Path
 * Selection (a later step) computes a drag delta, applies it to every anchor via `onUpdate`, then
 * resets the Group's own position back to (0,0) so the transform never accumulates on the node —
 * the same principle `TextLayerNode.onTransformEnd` already applies to its scale.
 *
 * Drawn with a `Shape`'s `sceneFunc` + `traceAnchors` rather than one Konva primitive per segment,
 * so committed paths, the live pen preview, and export all trace identical geometry from one
 * function instead of three implementations that could drift.
 */
export function PathLayerNode({ layer, groupRef, selected, draggable, directSelect, onSelect, onUpdate }: PathLayerNodeProps) {
  const path = layer.path!;

  function updateAnchor(index: number, patch: Partial<PathAnchor>) {
    onUpdate({ anchors: path.anchors.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  }

  /** Dragging a handle patches only that side; a smooth anchor mirrors the opposite handle to stay
   *  collinear (same symmetric convention the Pen tool's own click-drag placement uses), a corner
   *  anchor leaves the other handle untouched. */
  function updateHandle(index: number, side: 'handleIn' | 'handleOut', offset: { x: number; y: number }) {
    const a = path.anchors[index];
    if (a.type === 'smooth') {
      const other = side === 'handleIn' ? 'handleOut' : 'handleIn';
      updateAnchor(index, { [side]: offset, [other]: { x: -offset.x, y: -offset.y } } as Partial<PathAnchor>);
    } else {
      updateAnchor(index, { [side]: offset } as Partial<PathAnchor>);
    }
  }

  return (
    <Group
      ref={groupRef}
      draggable={draggable}
      onClick={(e) => onSelect(selectModeFor(e.evt))}
      onTap={(e) => onSelect(selectModeFor(e.evt))}
      onDragEnd={(e) => {
        const node = e.target as Konva.Group;
        const dx = node.x();
        const dy = node.y();
        // The Group itself never keeps a position — translate every anchor by the drag delta, then
        // reset the node back to (0,0) so the transform never accumulates (same principle
        // TextLayerNode.onTransformEnd applies to scale).
        node.position({ x: 0, y: 0 });
        onUpdate({
          anchors: path.anchors.map(a => ({ ...a, point: { x: a.point.x + dx, y: a.point.y + dy } })),
        });
      }}
    >
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          traceAnchors(ctx, path.anchors, path.closed);
          ctx.fillStrokeShape(shape);
        }}
        fill={path.fill.enabled ? path.fill.color : undefined}
        stroke={path.stroke.enabled ? path.stroke.color : undefined}
        strokeWidth={path.stroke.width}
        hitStrokeWidth={Math.max(12, path.stroke.width)}
      />
      {selected && (
        <Shape
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            traceAnchors(ctx, path.anchors, path.closed);
            ctx.fillStrokeShape(shape);
          }}
          stroke="#38bdf8"
          strokeWidth={1}
          dash={[4, 3]}
          listening={false}
        />
      )}

      {selected && directSelect && path.anchors.map((a, i) => (
        <Group key={a.id}>
          {(a.handleIn || a.handleOut) && (
            <Line
              points={[
                a.point.x + (a.handleIn?.x ?? 0), a.point.y + (a.handleIn?.y ?? 0),
                a.point.x + (a.handleOut?.x ?? 0), a.point.y + (a.handleOut?.y ?? 0),
              ]}
              stroke="#38bdf8" strokeWidth={1} listening={false}
            />
          )}
          {a.handleOut && (
            <Ellipse
              x={a.point.x + a.handleOut.x} y={a.point.y + a.handleOut.y} radiusX={3} radiusY={3}
              fill="#38bdf8" draggable
              onDragMove={(e) => updateHandle(i, 'handleOut', { x: e.target.x() - a.point.x, y: e.target.y() - a.point.y })}
            />
          )}
          {a.handleIn && (
            <Ellipse
              x={a.point.x + a.handleIn.x} y={a.point.y + a.handleIn.y} radiusX={3} radiusY={3}
              fill="#38bdf8" draggable
              onDragMove={(e) => updateHandle(i, 'handleIn', { x: e.target.x() - a.point.x, y: e.target.y() - a.point.y })}
            />
          )}
          <Rect
            x={a.point.x - 4} y={a.point.y - 4} width={8} height={8}
            fill={a.type === 'smooth' ? '#38bdf8' : '#ffffff'} stroke="#000000" strokeWidth={0.5}
            draggable
            onDragMove={(e) => updateAnchor(i, { point: { x: e.target.x() + 4, y: e.target.y() + 4 } })}
            // Alt-click converts corner<->smooth — Photoshop's own Direct Selection gesture, and
            // doesn't collide with Alt's other meanings elsewhere (selection-combine "subtract",
            // paint-tool eyedropper) since those only fire under their own, mutually exclusive tools.
            onClick={(e) => { if (e.evt.altKey) onUpdate({ anchors: toggleAnchorType(path.anchors, i) }); }}
          />
        </Group>
      ))}
    </Group>
  );
}
