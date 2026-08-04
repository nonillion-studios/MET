import { Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import type { PlacedImageLayerData, LayerSelectMode } from './studioTypes';

interface PlacedImageLayerNodeProps {
  data: PlacedImageLayerData;
  /** The source canvas at the image's own natural size — never resampled, only ever redrawn at a
   *  different Konva-level transform. See PlacedImageLayerData's own doc comment. */
  canvas: HTMLCanvasElement;
  nodeRef: (node: Konva.Image | null) => void;
  draggable: boolean;
  onSelect: (mode: LayerSelectMode) => void;
  onUpdate: (patch: Partial<PlacedImageLayerData>) => void;
}

function selectModeFor(evt: MouseEvent | TouchEvent): LayerSelectMode {
  const e = evt as MouseEvent;
  return e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
}

/** Konva name on a placed-image layer's node. Every other Konva.Image on the stage (the page
 *  background, a clean-patch layer's raster fill) is inert decoration with `listening={false}`, so
 *  StudioCanvas.tsx's "did this click land on empty canvas?" checks treat `targetClass === 'Image'`
 *  as empty — this node is a real interactive layer, so it needs a name to be excluded the same way
 *  TextLayerNode's TEXT_HIT_NAME already is (see handleStageClick and the two onEmpty checks in
 *  StudioCanvas.tsx). Without this, a click/drag on a placed image gets double-handled: Konva's own
 *  native node drag moves it, while the Stage-level handler *also* reads the click as "empty
 *  canvas" and starts an object-marquee drag on top of it. */
export const PLACED_IMAGE_HIT_NAME = 'placed-image-hit';

/**
 * A placed image ("Smart Object") on the Konva stage — a plain `Konva.Image` pointed at the source
 * canvas (untouched at its natural size), positioned purely via Konva's own x/y/scale/rotation
 * transform props. Free Transform (resize/rotate handles) is the shared `Transformer` in
 * StudioCanvas.tsx, the same widget text layers already use — this node just needs to register
 * itself in that Transformer's node list (via `nodeRef`) and persist the resulting transform back
 * onto `PlacedImageLayerData` on drag/transform end, rather than baking it into pixels the way
 * TextLayerNode's own onTransformEnd converts scale into fontSize/width.
 */
export function PlacedImageLayerNode({ data, canvas, nodeRef, draggable, onSelect, onUpdate }: PlacedImageLayerNodeProps) {
  return (
    <KonvaImage
      ref={nodeRef}
      name={PLACED_IMAGE_HIT_NAME}
      image={canvas}
      width={data.naturalWidth}
      height={data.naturalHeight}
      offsetX={data.naturalWidth / 2}
      offsetY={data.naturalHeight / 2}
      x={data.x}
      y={data.y}
      scaleX={data.scaleX}
      scaleY={data.scaleY}
      rotation={data.rotation}
      draggable={draggable}
      onClick={(e) => onSelect(selectModeFor(e.evt))}
      onTap={(e) => onSelect(selectModeFor(e.evt))}
      onDragEnd={(e) => onUpdate({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Image;
        // Unlike text (which converts scale into fontSize/width and resets the node's own scale to
        // 1), the transform stays on the node — that's what makes this non-destructive.
        onUpdate({ x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
      }}
    />
  );
}
