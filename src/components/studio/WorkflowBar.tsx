export interface WorkflowStage {
  id: string;
  label: string;
  /** True once real state confirms this stage has been reached (never a fake/simulated checkmark). */
  active: boolean;
  /** False for stages the app doesn't yet track (e.g. Detection/Review/Export) — shown dim, not lit or checked. */
  tracked: boolean;
}
