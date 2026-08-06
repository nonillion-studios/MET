import { useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Modal, Button } from './ui';
import { CURSOR_THEME_COLORS, loadCursorTheme, saveCursorTheme } from '../lib/cursorTheme';

interface JoinLiveSessionModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (prefs: { micOn: boolean; cursorColor: string }) => void;
}

/** Shown to a member before they join someone else's live Studio session — matches the "choose
 *  mic/camera before entering" step every video-call app has, plus a cursor colour picker so a
 *  viewer's pointer reads as themselves rather than an arbitrary per-user hash colour (see
 *  cursorTheme.ts). Both choices are just starting state: mic can still be toggled from
 *  CollabSessionPanel once inside, this only decides whether joining voice happens automatically. */
export function JoinLiveSessionModal({ open, onCancel, onConfirm }: JoinLiveSessionModalProps) {
  const [micOn, setMicOn] = useState(false);
  const [cursorColor, setCursorColor] = useState(loadCursorTheme);

  function confirm() {
    saveCursorTheme(cursorColor);
    onConfirm({ micOn, cursorColor });
  }

  return (
    <Modal open={open} onClose={onCancel} title="Join Live Session" size="sm">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-medium text-ink-muted mb-2">Microphone</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMicOn(false)}
              className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-control text-sm font-medium transition-colors ${
                !micOn ? 'bg-ink/10 text-ink' : 'bg-ink/5 text-ink-faint hover:bg-ink/10'
              }`}
            >
              <MicOff size={14} /> Off
            </button>
            <button
              type="button"
              onClick={() => setMicOn(true)}
              className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-control text-sm font-medium transition-colors ${
                micOn ? 'bg-accent-soft text-accent' : 'bg-ink/5 text-ink-faint hover:bg-ink/10'
              }`}
            >
              <Mic size={14} /> On
            </button>
          </div>
          <p className="text-[11px] text-ink-faint mt-1.5">You can still mute or join voice later from inside the session.</p>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-muted mb-2">Cursor colour</p>
          <div className="flex gap-2 flex-wrap">
            {CURSOR_THEME_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color} cursor`}
                onClick={() => setCursorColor(color)}
                className={`w-8 h-8 rounded-full transition-transform ${cursorColor === color ? 'ring-2 ring-offset-2 ring-ink scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={confirm}>Join Session</Button>
        </div>
      </div>
    </Modal>
  );
}
