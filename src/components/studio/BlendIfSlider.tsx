import { useEffect, useRef, useState } from 'react';
import type { BlendIfRange } from './studioTypes';

interface BlendIfSliderProps {
  range: BlendIfRange;
  onChange: (next: BlendIfRange) => void;
}

type DragMode =
  | { kind: 'move'; pair: 'black' | 'white' }
  | { kind: 'split'; pair: 'black' | 'white'; anchor: number }
  | { kind: 'edge'; field: keyof BlendIfRange };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fmt(a: number, b: number): string {
  return a === b ? String(a) : `${a}/${b}`;
}

function nextRangeFor(prev: BlendIfRange, mode: DragMode, v: number): BlendIfRange {
  switch (mode.kind) {
    case 'move':
      return mode.pair === 'black'
        ? { ...prev, blackMin: v, blackMax: v }
        : { ...prev, whiteMin: v, whiteMax: v };
    case 'split':
      // The handle the user grabbed stays put; the other half of the pair follows the pointer,
      // clamped so it can never cross back over the anchor (matching the black/white min<=max
      // invariant the rest of this component and `layerEffects.ts`'s ramp math both assume).
      return mode.pair === 'black'
        ? { ...prev, blackMin: mode.anchor, blackMax: clamp(v, mode.anchor, 255) }
        : { ...prev, whiteMin: clamp(v, 0, mode.anchor), whiteMax: mode.anchor };
    case 'edge': {
      switch (mode.field) {
        case 'blackMin': return { ...prev, blackMin: clamp(v, 0, prev.blackMax) };
        case 'blackMax': return { ...prev, blackMax: clamp(v, prev.blackMin, 255) };
        case 'whiteMin': return { ...prev, whiteMin: clamp(v, 0, prev.whiteMax) };
        case 'whiteMax': return { ...prev, whiteMax: clamp(v, prev.whiteMin, 255) };
      }
    }
  }
}

/** One Blend If row (either "This Layer" or "Underlying Layer") — a black-to-white gradient track
 *  with a black handle-pair (shadows) on the left and a white handle-pair (highlights) on the
 *  right. Each pair drags as one rigid handle by default; Alt+drag splits it into two independently
 *  draggable halves for a smooth partial-transparency ramp, matching Photoshop's own Blend If UI.
 *  `onChange` is rAF-throttled the same way `Slider` in `panelControls.tsx` is (this feeds the same
 *  live-preview -> full layer-tree state update path, which is too heavy to run every pointer tick),
 *  with a guaranteed flush on release so no in-flight drag value is ever lost. */
export function BlendIfSlider({ range, onChange }: BlendIfSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(range);
  useEffect(() => setDraft(range), [range]);

  const dragRef = useRef<DragMode | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<BlendIfRange | null>(null);

  function flushPending() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (pendingRef.current != null) { onChange(pendingRef.current); pendingRef.current = null; }
  }

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  function valueAt(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(pct * 255);
  }

  function scheduleChange(next: BlendIfRange) {
    pendingRef.current = next;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingRef.current != null) { onChange(pendingRef.current); pendingRef.current = null; }
      });
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!trackRef.current) return;
    const v = valueAt(e.clientX);
    const marks: { field: keyof BlendIfRange; pair: 'black' | 'white'; value: number }[] = [
      { field: 'blackMin', pair: 'black', value: draft.blackMin },
      { field: 'blackMax', pair: 'black', value: draft.blackMax },
      { field: 'whiteMin', pair: 'white', value: draft.whiteMin },
      { field: 'whiteMax', pair: 'white', value: draft.whiteMax },
    ];
    let nearest = marks[0];
    for (const m of marks) if (Math.abs(m.value - v) < Math.abs(nearest.value - v)) nearest = m;

    const joined = nearest.pair === 'black' ? draft.blackMin === draft.blackMax : draft.whiteMin === draft.whiteMax;
    if (joined && e.altKey) {
      dragRef.current = { kind: 'split', pair: nearest.pair, anchor: nearest.value };
    } else if (joined) {
      dragRef.current = { kind: 'move', pair: nearest.pair };
    } else {
      dragRef.current = { kind: 'edge', field: nearest.field };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft((prev) => {
      const next = nextRangeFor(prev, dragRef.current!, v);
      scheduleChange(next);
      return next;
    });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || e.buttons !== 1) return;
    const v = valueAt(e.clientX);
    setDraft((prev) => {
      const next = nextRangeFor(prev, dragRef.current!, v);
      scheduleChange(next);
      return next;
    });
  }

  function handlePointerUp() {
    dragRef.current = null;
    flushPending();
  }

  function pct(v: number) {
    return `${(v / 255) * 100}%`;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-micro text-ink-faint tabular-nums">
        <span>Black: {fmt(draft.blackMin, draft.blackMax)}</span>
        <span>White: {fmt(draft.whiteMin, draft.whiteMax)}</span>
      </div>
      <div
        ref={trackRef}
        className="studio-interactive relative h-4 my-2 rounded-control border border-hairline cursor-pointer touch-none"
        style={{ background: 'linear-gradient(to right, #000, #fff)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {([
          ['blackMin', draft.blackMin, '#000'],
          ['blackMax', draft.blackMax, '#000'],
          ['whiteMin', draft.whiteMin, '#fff'],
          ['whiteMax', draft.whiteMax, '#fff'],
        ] as const).map(([field, value, fill]) => (
          <div
            key={field}
            className="absolute top-1/2 w-2.5 h-2.5 rotate-45 border border-ink/60 pointer-events-none -translate-x-1/2 -translate-y-1/2"
            style={{ left: pct(value), background: fill }}
          />
        ))}
      </div>
    </div>
  );
}
