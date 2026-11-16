import { useEffect, useRef, useState } from 'react';

interface CanvasHudProps {
  message: string | null;
  duration?: number;
}

export function CanvasHud({ message, duration = 800 }: CanvasHudProps) {
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!message) return;
    setDisplay(message.split('\x00')[0]);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [message, duration]);

  if (!display) return null;

  return (
    <div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-5 py-2.5 rounded-xl bg-black/70 text-white text-lg font-semibold pointer-events-none z-40 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {display}
    </div>
  );
}
