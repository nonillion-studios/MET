import { Ellipse, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { createIdentityMesh } from '../../lib/textWarp';
import type { TextLayerData, WarpMesh } from './studioTypes';
import { useRafBatchedPatch } from './useRafBatchedPatch';

interface TextWarpMeshOverlayProps {
  text: TextLayerData;
  /** The glyph box's local width/height — the same units `layout.width/height` and the rest of
   *  TextLayerNode's own chrome (W×H readout, overflow border) already position themselves in. */
  width: number;
  height: number;
  /** Stage zoom, to counter-scale handle size/stroke the same way TextLayerNode's own selected-
   *  state chrome already does, so handles read as a fixed on-screen size at any zoom. */
  scale: number;
  /** Fired continuously while dragging a handle (no history label upstream). */
  onPreview: (mesh: WarpMesh) => void;
  /** Fired once, on release (a real, undoable history entry upstream). */
  onCommit: (mesh: WarpMesh) => void;
}

function toLocal(nx: number, ny: number, width: number, height: number) {
  return { x: ((nx + 1) / 2) * width, y: ((ny + 1) / 2) * height };
}

function toNormalized(lx: number, ly: number, width: number, height: number) {
  return { x: (lx / Math.max(1, width)) * 2 - 1, y: (ly / Math.max(1, height)) * 2 - 1 };
}

/**
 * The on-canvas warp mesh editor — one draggable handle per control point plus the connecting grid
 * lines a Photoshop-style warp mesh is recognizable by, rendered directly on the Konva stage so
 * dragging a point deforms the actual text with a live preview, not a separate modal-only control.
 * Mounted by TextLayerNode only while this layer is selected and warp-editing is active (see
 * Studio.tsx's warpDialogLayerId — the same state that also drives the compact WarpTextDialog panel,
 * so both are simply "is the user currently editing this layer's warp").
 *
 * `text.warp.mesh` is the source of truth. A layer warped by preset alone (no mesh dragged yet)
 * still needs handles that reflect the preset's own curve, not a blank identity grid overlaid on
 * already-curved text — WarpTextDialog.tsx's `patch()` regenerates `mesh` via textWarp.ts's
 * `meshFromStyle` on every style/bend/H/V change specifically so this overlay never has to fall
 * back to `createIdentityMesh` except for a genuinely from-scratch custom warp (`style: 'none'`).
 */
export function TextWarpMeshOverlay({ text, width, height, scale, onPreview, onCommit }: TextWarpMeshOverlayProps) {
  const mesh = text.warp?.mesh ?? createIdentityMesh();
  const { schedule, cancel } = useRafBatchedPatch<WarpMesh>(onPreview);

  const handleRadius = 4 / scale;
  const lineWidth = 1 / scale;

  function withPoint(index: number, local: { x: number; y: number }): WarpMesh {
    const next = toNormalized(local.x, local.y, width, height);
    return { ...mesh, points: mesh.points.map((p, i) => (i === index ? next : p)) };
  }

  const gridLines: number[][] = [];
  for (let row = 0; row < mesh.rows; row++) {
    for (let col = 0; col < mesh.cols - 1; col++) {
      const a = toLocal(mesh.points[row * mesh.cols + col].x, mesh.points[row * mesh.cols + col].y, width, height);
      const b = toLocal(mesh.points[row * mesh.cols + col + 1].x, mesh.points[row * mesh.cols + col + 1].y, width, height);
      gridLines.push([a.x, a.y, b.x, b.y]);
    }
  }
  for (let col = 0; col < mesh.cols; col++) {
    for (let row = 0; row < mesh.rows - 1; row++) {
      const a = toLocal(mesh.points[row * mesh.cols + col].x, mesh.points[row * mesh.cols + col].y, width, height);
      const b = toLocal(mesh.points[(row + 1) * mesh.cols + col].x, mesh.points[(row + 1) * mesh.cols + col].y, width, height);
      gridLines.push([a.x, a.y, b.x, b.y]);
    }
  }

  return (
    <Group listening>
      {gridLines.map((pts, i) => (
        <Line key={i} points={pts} stroke="#38bdf8" strokeWidth={lineWidth} opacity={0.6} listening={false} />
      ))}
      {mesh.points.map((p, i) => {
        const pos = toLocal(p.x, p.y, width, height);
        return (
          <Ellipse
            key={i}
            x={pos.x}
            y={pos.y}
            radiusX={handleRadius}
            radiusY={handleRadius}
            fill="#38bdf8"
            stroke="#0b1220"
            strokeWidth={lineWidth}
            draggable
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const target = e.target;
              schedule(withPoint(i, { x: target.x(), y: target.y() }));
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              cancel();
              const target = e.target;
              onCommit(withPoint(i, { x: target.x(), y: target.y() }));
            }}
          />
        );
      })}
    </Group>
  );
}
