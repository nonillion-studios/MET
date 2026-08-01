import { useEffect, useRef } from 'react';
import { hsvToRgb } from './colorConversions';

interface HueSatSquareProps {
  hue: number;
  sat: number;
  val: number;
  onPick: (hue: number, sat: number) => void;
  size?: number;
}

/**
 * The Color panel's "Brightness Cube" mode: x = Hue (0–360), y = Saturation (100 top, 0 bottom),
 * rendered at the color's *current* Brightness — pairs with a Brightness slider below it in
 * ColorPanel, matching Color Wheel's own square+slider shape but with Brightness as the slider
 * axis instead of Hue, so all three modes expose a genuinely different pair of draggable channels.
 */
export function HueSatSquare({ hue, sat, val, onPick, size = 160 }: HueSatSquareProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rainbow = ctx.createLinearGradient(0, 0, size, 0);
    for (let deg = 0; deg <= 360; deg += 30) {
      const { r, g, b } = hsvToRgb({ h: deg, s: 100, v: val });
      rainbow.addColorStop(deg / 360, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = rainbow;
    ctx.fillRect(0, 0, size, size);
    // Top (y=0) is full saturation (no white mixed in); bottom (y=size) is fully desaturated.
    const satGrad = ctx.createLinearGradient(0, 0, 0, size);
    satGrad.addColorStop(0, 'rgba(255,255,255,0)');
    satGrad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, size, size);
  }, [val, size]);

  function handlePick(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360;
    const s = 100 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) * 100;
    onPick(h, s);
  }

  return (
    <div className="relative" style={{ width: size, aspectRatio: '1 / 1' }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="w-full h-full rounded-control border border-hairline cursor-crosshair"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePick(e); }}
        onPointerMove={(e) => { if (e.buttons === 1) handlePick(e); }}
      />
      <div
        className="absolute w-3 h-3 rounded-full border-2 border-white pointer-events-none -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${(hue / 360) * 100}%`, top: `${100 - sat}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }}
      />
    </div>
  );
}
