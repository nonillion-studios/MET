interface WorkflowStage {
  id: string;
  label: string;
  /** True once real state confirms this stage has been reached (never a fake/simulated checkmark). */
  active: boolean;
  /** False for stages the app doesn't yet track (e.g. Detection/Review/Export) — shown dim, not lit or checked. */
  tracked: boolean;
}

interface WorkflowBarProps {
  stages: WorkflowStage[];
}

/** Slim strip reflecting the real Chapter → Page → ... → Export pipeline state, so the
 *  interface reinforces the workflow instead of a wall of unrelated buttons. */
export function WorkflowBar({ stages }: WorkflowBarProps) {
  return (
    <div className="liquid-glass-bar flex items-center gap-1 px-3 h-8 shrink-0 border-b border-hairline overflow-x-auto">
      {stages.map((stage, i) => (
        <div key={stage.id} className="flex items-center gap-1 shrink-0">
          {i > 0 && <span className="text-ink-faint/30 text-[11px] px-0.5">›</span>}
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
              !stage.tracked
                ? 'text-ink-faint/40'
                : stage.active
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-faint'
            }`}
          >
            {stage.label}
          </span>
        </div>
      ))}
    </div>
  );
}
