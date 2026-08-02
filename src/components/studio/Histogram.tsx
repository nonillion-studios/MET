import { useEffect, useRef } from 'react';
import { computeHistogram } from '../../lib/histogram';

interface HistogramProps {
  /** The pixels to chart — Levels/Threshold both read this from the full page composite via
   *  `getHistogramSource`, resolved once by the caller rather than re-reading a canvas here. */
  imageData: ImageData | null;
  /** Which channel's bucket counts to draw — luminance by default (matches Photoshop's own
   *  "Composite" histogram channel). */
  channel?: 'luminance' | 'r' | 'g' | 'b';
  height?: number;
}

/** Static bar chart — a canvas `fillRect` loop, no per-bar interactivity needed, matching this
 *  app's existing "canvas for static, SVG for interactive" split already established by
 *  `CurvesEditor.tsx`'s own reasoning. Greenfield: no histogram-drawing code existed anywhere in
 *  this repo before Section 4. */
export function Histogram({ imageData, channel = 'luminance', height = 60 }: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!imageData) return;

    const hist = computeHistogram(imageData);
    const counts = hist[channel];
    const max = Math.max(1, ...Array.from(counts));
    const barWidth = canvas.width / 256;
    ctx.fillStyle = 'rgba(124, 106, 245, 0.75)';
    for (let v = 0; v < 256; v++) {
      const h = (counts[v] / max) * canvas.height;
      ctx.fillRect(v * barWidth, canvas.height - h, Math.max(1, barWidth), h);
    }
  }, [imageData, channel]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={height}
      className="w-full rounded-control border border-hairline bg-ink/5"
      style={{ height }}
    />
  );
}
