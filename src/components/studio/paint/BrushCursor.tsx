import { effectiveTip, type PaintSettings } from './paintEngine';

interface BrushCursorProps {
  /** Pointer position in *container* (CSS) pixels, or null when the pointer is off-canvas. */
  pos: { x: number; y: number } | null;
  /** Stage zoom, so the ring matches the pixels the brush will actually cover. */
  scale: number;
  settings: PaintSettings;
  tool: string;
}

const STROKE_TOOLS = new Set(['brush', 'pencil', 'eraser']);
/** Tools that are brush-sized but don't use the brush tip geometry (no angle/roundness). */
const ROUND_SIZED_TOOLS = new Set(['clone', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'spot-heal', 'liquify']);

/**
 * Live brush outline that tracks the pointer, drawn in container space above the
 * Konva stage. Shows the tip's real on-screen footprint: size × zoom, plus
 * angle/roundness for non-round tips and a second inner ring marking where a soft
 * tip's falloff begins.
 *
 * Rendered as SVG rather than a Konva node so it never lands in exports or the
 * layer stack, and so moving it can't dirty the paint canvas.
 */
export function BrushCursor({ pos, scale, settings, tool }: BrushCursorProps) {
  if (!pos) return null;
  const isStroke = STROKE_TOOLS.has(tool);
  if (!isStroke && !ROUND_SIZED_TOOLS.has(tool)) return null;

  const geom = isStroke
    ? effectiveTip(settings, tool as 'brush' | 'pencil' | 'eraser')
    : { size: settings.size, hardness: 1, angle: 0, roundness: 1 };

  const screenSize = geom.size * scale;

  // Below a few px the ring is smaller than the cursor itself and just reads as
  // noise — fall back to a crosshair, which is what it's actually useful as.
  if (screenSize < 4) {
    return (
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
        <g stroke="#fff" strokeWidth={1} opacity={0.9}>
          <line x1={pos.x - 6} y1={pos.y} x2={pos.x + 6} y2={pos.y} />
          <line x1={pos.x} y1={pos.y - 6} x2={pos.x} y2={pos.y + 6} />
        </g>
        <g stroke="#000" strokeWidth={1} opacity={0.35}>
          <line x1={pos.x - 6} y1={pos.y + 1} x2={pos.x + 6} y2={pos.y + 1} />
          <line x1={pos.x + 1} y1={pos.y - 6} x2={pos.x + 1} y2={pos.y + 6} />
        </g>
      </svg>
    );
  }

  const rx = screenSize / 2;
  const ry = (screenSize / 2) * geom.roundness;
  const transform = `translate(${pos.x} ${pos.y}) rotate(${geom.angle})`;
  const isSquare = isStroke && settings.brushShape === 'square';
  // A soft tip's paint starts fading at `hardness` of the radius — draw that as a
  // second, dimmer ring so "hardness" is visible before you commit a stroke.
  const showInner = geom.hardness < 0.95;

  return (
    <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
      <g transform={transform}>
        {isSquare ? (
          <>
            {/* Double-stroked (dark under light) so the outline stays legible on any art. */}
            <rect x={-rx} y={-ry} width={rx * 2} height={ry * 2} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={2} />
            <rect x={-rx} y={-ry} width={rx * 2} height={ry * 2} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={1} />
            {showInner && (
              <rect
                x={-rx * geom.hardness} y={-ry * geom.hardness}
                width={rx * 2 * geom.hardness} height={ry * 2 * geom.hardness}
                fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3"
              />
            )}
          </>
        ) : (
          <>
            <ellipse rx={rx} ry={ry} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={2} />
            <ellipse rx={rx} ry={ry} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={1} />
            {showInner && (
              <ellipse
                rx={rx * geom.hardness} ry={ry * geom.hardness}
                fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3"
              />
            )}
          </>
        )}
      </g>
    </svg>
  );
}
