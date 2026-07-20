import { useEffect, useState } from 'react';

interface StudioBuildTransitionProps {
  onDone: () => void;
}

const CUBE_DELAYS = [0, 0.12, 0.24, 0.36, 0.48];

/** Full-screen black loading transition shown briefly while entering Studio. */
export function StudioBuildTransition({ onDone }: StudioBuildTransitionProps) {
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadingOut(true), 1100);
    const doneTimer = setTimeout(onDone, 1400);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div
      className={`studio-shell fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center gap-6 ${fadingOut ? 'animate-studio-build-fade-out' : ''}`}
    >
      <div className="flex items-end gap-3">
        {CUBE_DELAYS.map((delay, i) => (
          <div
            key={i}
            className="w-5 h-5 sm:w-6 sm:h-6 rounded-[3px] bg-accent animate-studio-cube"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>
      <p className="text-sm font-display font-semibold tracking-wide text-white/80 uppercase">Building Studio…</p>
    </div>
  );
}
