import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import logo from '../assets/logo.jpg';

const LOADING_LINES = [
  'Waking up the ink...',
  'Stretching the speech bubbles...',
  'Sharpening the fonts...',
  'Polishing the panels...',
];

export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const start = performance.now();
    // Eased, non-linear ramp so it reads as "alive" rather than a flat timer -
    // quick early gains, a believable stall around 70-90%, then a snappy finish.
    const duration = 1900;
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = t < 0.85 ? Math.pow(t / 0.85, 0.6) * 0.9 : 0.9 + (t - 0.85) / 0.15 * 0.1;
      setProgress(Math.min(100, Math.round(eased * 100)));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setLeaving(true);
        setTimeout(onFinish, 550);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onFinish]);

  useEffect(() => {
    const lineTimer = setInterval(() => {
      setLineIndex(i => (i + 1) % LOADING_LINES.length);
    }, 650);
    return () => clearInterval(lineTimer);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[999] flex flex-col items-center justify-center bg-base overflow-hidden transition-all duration-500 ease-out ${
        leaving ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Ambient accent gradient glow, breathing slowly behind everything */}
      <div className="absolute inset-0 -z-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full bg-accent/25 blur-[110px] animate-splash-breathe" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[260px] h-[260px] rounded-full bg-accent/15 blur-[80px] animate-splash-breathe [animation-delay:0.6s]" />
        {/* Slow-drifting fog blobs for depth, reusing the app-wide fog keyframes */}
        <div className="absolute -top-10 -left-10 w-[420px] h-[420px] rounded-full bg-accent/15 blur-[100px] animate-[fogDriftA_18s_ease-in-out_infinite]" />
        <div className="absolute -bottom-16 -right-10 w-[360px] h-[360px] rounded-full bg-accent/12 blur-[90px] animate-[fogDriftB_22s_ease-in-out_infinite] [animation-delay:-8s]" />
      </div>

      <div className="relative flex flex-col items-center gap-7 px-6">
        {/* Logo, with a rotating specular ring, soft glow + gentle float */}
        <div className="relative animate-splash-float">
          <div className="absolute inset-0 rounded-full bg-accent/30 blur-3xl scale-110" />
          <div
            className="absolute -inset-3 rounded-full animate-spin [animation-duration:3.2s]"
            style={{
              background: 'conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--color-accent) 75%, transparent) 25%, transparent 55%)',
              WebkitMaskImage: 'radial-gradient(closest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
              maskImage: 'radial-gradient(closest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
            }}
          />
          <img
            src={logo}
            alt="MangaAI"
            className="relative w-32 h-32 sm:w-40 sm:h-40 object-contain rounded-[28px] drop-shadow-[0_0_35px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
            draggable={false}
          />
        </div>

        {/* Wordmark, staggered in after the logo */}
        <div className="flex flex-col items-center gap-1.5 animate-fade-in-up [animation-delay:150ms]">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            Manga<span className="text-accent">AI</span>
          </h1>
          <p className="text-[11px] font-mono tracking-[0.35em] text-accent/70 uppercase">Studio</p>
        </div>

        {/* Creative loading bar: fill + traveling shimmer + glowing leading dot + live percentage */}
        <div className="flex flex-col items-center gap-2.5 w-56 sm:w-64 animate-fade-in-up [animation-delay:280ms]">
          <div className="relative w-full h-[5px] rounded-full bg-ink/10 overflow-visible border border-hairline">
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-150 ease-out overflow-hidden" style={{ width: `${progress}%` }}>
              <div className="absolute inset-0 animate-splash-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            </div>
            <div
              className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_10px_2px_var(--color-accent)] transition-[left] duration-150 ease-out -translate-y-1/2"
              style={{ left: `${progress}%`, transform: 'translate(-50%, -50%)' }}
            />
          </div>
          <div className="flex items-center justify-between w-full">
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-ink-faint tracking-wider transition-opacity duration-300 truncate">
              {progress >= 90 && <Sparkles size={11} className="text-accent shrink-0 animate-pulse" />}
              {LOADING_LINES[lineIndex]}
            </span>
            <span className="text-[10px] font-mono text-accent tabular-nums shrink-0 pl-2">{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
