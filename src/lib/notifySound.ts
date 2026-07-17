// Small generated notification blip via WebAudio — no bundled audio asset needed,
// and it's distinct from the browser Notification API (which notifications.ts
// already drives as the "web notify" half).
let ctx: AudioContext | null = null;

export function playNotificationSound(): void {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    // Audio not available (autoplay policy, unsupported browser) — silently skip.
  }
}
