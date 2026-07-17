import { useCallback, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { Input } from './Input';
import { cn } from './cn';

function randomChallenge() {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const op = Math.random() > 0.5 ? '+' : '×';
  const answer = op === '+' ? a + b : a * b;
  return { a, b, op, answer };
}

export interface CaptchaHandle {
  /** Checks the current answer and returns whether it was correct — resets with a fresh
   *  challenge either way, so a wrong guess (or a reused stale one) can't be retried blind. */
  verify: () => boolean;
}

/** A tiny self-hosted arithmetic challenge — no external captcha service, matching this app's
 *  offline-first design intent (see Fonts section of CLAUDE.md re: no Google-Fonts-style CDN deps).
 *  Not meant to stop a determined bot, only casual scripted signups. */
export function Captcha({ onChange, className }: { onChange: (verified: boolean) => void; className?: string }) {
  const [challenge, setChallenge] = useState(randomChallenge);
  const [value, setValue] = useState('');
  const correctAnswer = useMemo(() => challenge.answer, [challenge]);

  const reroll = useCallback(() => {
    setChallenge(randomChallenge());
    setValue('');
    onChange(false);
  }, [onChange]);

  const handleChange = (raw: string) => {
    setValue(raw);
    onChange(raw.trim() !== '' && Number(raw) === correctAnswer);
  };

  const solved = value.trim() !== '' && Number(value) === correctAnswer;

  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-xs text-accent font-semibold flex items-center gap-1"><ShieldCheck size={12} /> Quick check</label>
      <div className="flex items-center gap-2">
        <div className={cn(
          'shrink-0 h-9 px-3 rounded-control border flex items-center gap-1.5 font-mono text-sm select-none transition-colors',
          solved ? 'border-success/40 bg-success/10 text-success' : 'border-hairline bg-ink/5 text-ink'
        )}>
          {challenge.a} {challenge.op} {challenge.b} =
        </div>
        <Input
          type="text"
          inputMode="numeric"
          placeholder="?"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="w-20 text-center"
        />
        <button
          type="button"
          onClick={reroll}
          aria-label="New challenge"
          title="New challenge"
          className="shrink-0 w-9 h-9 rounded-control border border-hairline text-ink-faint hover:text-accent hover:border-accent/40 transition-colors flex items-center justify-center"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}
