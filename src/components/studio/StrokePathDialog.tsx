import { useState } from 'react';
import { Modal, Button, Switch } from '../ui';

export interface StrokePathResult {
  tool: 'brush' | 'pencil' | 'eraser';
  simulatePressure: boolean;
}

const TOOL_OPTIONS: { id: StrokePathResult['tool']; label: string }[] = [
  { id: 'brush', label: 'Brush' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'eraser', label: 'Eraser' },
];

interface StrokePathDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: StrokePathResult) => void;
}

/**
 * Stroke Path used to bake a flat 2D-context outline with no way to choose a tool. Brush/Pencil/
 * Eraser now really replay the current brush's dynamics along the path (see
 * `paintEngine.ts`'s `strokePathOntoCanvas`). Clone Stamp/Healing Brush are shown disabled — both
 * need an interactive alt-clicked source point with no non-interactive equivalent, so wiring them
 * up here would mean silently stroking from whatever stale source point happened to be set, not a
 * real "stroke path with this tool" — an honest gap, not a missing feature that was skipped.
 */
export function StrokePathDialog({ open, onClose, onConfirm }: StrokePathDialogProps) {
  const [tool, setTool] = useState<StrokePathResult['tool']>('brush');
  const [simulatePressure, setSimulatePressure] = useState(false);

  function handleOk() {
    onConfirm({ tool, simulatePressure });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stroke Path"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleOk}>OK</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Tool</span>
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as StrokePathResult['tool'])}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {TOOL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            <option value="clone" disabled>Clone Stamp (needs an active source point — use the live tool instead)</option>
            <option value="heal" disabled>Healing Brush (needs an active source point — use the live tool instead)</option>
          </select>
        </label>

        <label className="flex items-center justify-between text-micro text-ink-faint">
          <span>Simulate Pressure</span>
          <Switch checked={simulatePressure} onChange={setSimulatePressure} aria-label="Simulate Pressure" />
        </label>
      </div>
    </Modal>
  );
}
