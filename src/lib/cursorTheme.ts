/** A viewer's chosen live-session cursor colour, persisted locally per-device (not per-account —
 *  there's no profile column for it, and "which colour I like" isn't something that needs to sync
 *  across devices). Mirrors CollabCursors.tsx's own palette so a chosen swatch renders identically
 *  to the deterministic per-user fallback colour every *other* participant still uses. */

export const CURSOR_THEME_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#e879f9', '#eab308', '#14b8a6', '#ef4444'];

const STORAGE_KEY = 'met_cursor_theme';

export function loadCursorTheme(): string {
  if (typeof window === 'undefined') return CURSOR_THEME_COLORS[0];
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && CURSOR_THEME_COLORS.includes(stored) ? stored : CURSOR_THEME_COLORS[0];
}

export function saveCursorTheme(color: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, color);
}
