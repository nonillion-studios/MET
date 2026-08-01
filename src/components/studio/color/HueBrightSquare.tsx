import { useEffect, useRef } from 'react';
import { hsvToRgb } from './colorConversions';

interface HueBrightSquareProps {
  hue: number;
  sat: number;
  val: number;
  onPick: (hue: number, val: number) => void;
  size?: number;
}

/**
 * The Color panel's "Hue Cube" mode: x = Hue (0–360), y = Brightness (100 top, 0 bottom), rendered
 * at the color's *current* Saturation — this mode has no slider of its own, so saturation stays
 * whatever it already was, unchanged by picks here (Color Wheel already owns the Sat×Bright square;
 * this one exists specifically to make Hue directly draggable instead of slider-only).
 */
export function HueBrightSquare({ hue, sat, val, onPick, size = 160 }: HueBrightSquareProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // A multi-stop rainbow at the current saturation approximates continuous hue — canvas gradients
    // only support discrete stops, so more stops read as smoother; every 30° is plenty for a 160px bar.
    const rainbow = ctx.createLinearGradient(0, 0, size, 0);
    for (let deg = 0; deg <= 360; deg += 30) {
      const { r, g, b } = hsvToRgb({ h: deg, s: sat, v: 100 });
      rainbow.addColorStop(deg / 360, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = rainbow;
    ctx.fillRect(0, 0, size, size);
    const brightGrad = ctx.createLinearGradient(0, 0, 0, size);
    brightGrad.addColorStop(0, 'rgba(0,0,0,0)');
    brightGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = brightGrad;
    ctx.fillRect(0, 0, size, size);
  }, [sat, size]);

  function handlePick(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360;
    const v = 100 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) * 100;
    onPick(h, v);
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
        style={{ left: `${(hue / 360) * 100}%`, top: `${100 - val}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }}
      />
    </div>
  );
}
