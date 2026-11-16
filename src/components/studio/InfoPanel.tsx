import { useEffect, useState } from 'react';
import { StudioPanel } from './StudioPanel';
import type { Selection } from './paint/selection';
import { hasSelection, selectionBounds } from './paint/selection';

export interface CursorInfo {
  x: number;
  y: number;
  color: { r: number; g: number; b: number; a: number } | null;
}

interface InfoPanelProps {
  cursor: CursorInfo | null;
  selection: Selection;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  hideTitle?: boolean;
}

function pad2(n: number): string { return n.toString(16).padStart(2, '0'); }
function rgbaHex(c: { r: number; g: number; b: number }): string {
  return `#${pad2(c.r)}${pad2(c.g)}${pad2(c.b)}`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-faint shrink-0">{label}</span>
      <span className="text-ink font-mono tabular-nums text-right">{value}</span>
    </div>
  );
}

export function InfoPanel({ cursor, selection, pageWidth, pageHeight, zoom, hideTitle }: InfoPanelProps) {
  const hasSel = hasSelection(selection);
  const selBounds = hasSel ? selectionBounds(selection) : null;

  return (
    <StudioPanel title="Info" hideTitle={hideTitle} bare bodyClassName="p-2 flex flex-col gap-1 text-micro">
      {/* Cursor position */}
      <div className="flex flex-col gap-0.5">
        <InfoRow label="X" value={cursor ? `${Math.round(cursor.x)} px` : '—'} />
        <InfoRow label="Y" value={cursor ? `${Math.round(cursor.y)} px` : '—'} />
      </div>

      {/* Pixel color under cursor */}
      {cursor?.color && (
        <div className="flex flex-col gap-0.5 pt-1 border-t border-hairline/50">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-sm border border-hairline/60"
              style={{ backgroundColor: rgbaHex(cursor.color) }} />
            <span className="text-ink font-mono">{rgbaHex(cursor.color).toUpperCase()}</span>
            <span className="text-ink-faint ml-auto">A: {cursor.color.a}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-ink-faint">R: <span className="text-ink">{cursor.color.r}</span></span>
            <span className="text-ink-faint">G: <span className="text-ink">{cursor.color.g}</span></span>
            <span className="text-ink-faint">B: <span className="text-ink">{cursor.color.b}</span></span>
          </div>
        </div>
      )}

      {/* Selection bounds */}
      {selBounds && (
        <div className="flex flex-col gap-0.5 pt-1 border-t border-hairline/50">
          <span className="text-ink-faint font-semibold">Selection</span>
          <InfoRow label="X" value={`${selBounds.x} px`} />
          <InfoRow label="Y" value={`${selBounds.y} px`} />
          <InfoRow label="W" value={`${selBounds.width} px`} />
          <InfoRow label="H" value={`${selBounds.height} px`} />
        </div>
      )}

      {/* Document info */}
      <div className="flex flex-col gap-0.5 pt-1 border-t border-hairline/50">
        <span className="text-ink-faint font-semibold">Document</span>
        <InfoRow label="Size" value={`${pageWidth} × ${pageHeight}`} />
        <InfoRow label="Zoom" value={`${Math.round(zoom * 100)}%`} />
      </div>
    </StudioPanel>
  );
}
