import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

interface HistoryContextValue {
  entries: { label: string }[];
  /** Index of the entry that was most recently applied (-1 = nothing done yet). */
  cursor: number;
  push: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Jump directly to a point in history (used by clicking an entry in the History panel). */
  jumpTo: (index: number) => void;
}

const MAX_ENTRIES = 50;

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const entriesRef = useRef<HistoryEntry[]>([]);
  const cursorRef = useRef(-1);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender(n => n + 1), []);

  const push = useCallback((entry: HistoryEntry) => {
    entriesRef.current = entriesRef.current.slice(0, cursorRef.current + 1);
    entriesRef.current.push(entry);
    if (entriesRef.current.length > MAX_ENTRIES) entriesRef.current.shift();
    cursorRef.current = entriesRef.current.length - 1;
    bump();
  }, [bump]);

  const undo = useCallback(() => {
    if (cursorRef.current < 0) return;
    entriesRef.current[cursorRef.current].undo();
    cursorRef.current -= 1;
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    if (cursorRef.current >= entriesRef.current.length - 1) return;
    cursorRef.current += 1;
    entriesRef.current[cursorRef.current].redo();
    bump();
  }, [bump]);

  const jumpTo = useCallback((index: number) => {
    while (cursorRef.current > index) undo();
    while (cursorRef.current < index) redo();
  }, [undo, redo]);

  const value = useMemo<HistoryContextValue>(() => ({
    entries: entriesRef.current.map(e => ({ label: e.label })),
    cursor: cursorRef.current,
    push, undo, redo, jumpTo,
    canUndo: cursorRef.current >= 0,
    canRedo: cursorRef.current < entriesRef.current.length - 1,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [push, undo, redo, jumpTo, entriesRef.current.length, cursorRef.current]);

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error('useHistory must be used within a HistoryProvider');
  return ctx;
}
