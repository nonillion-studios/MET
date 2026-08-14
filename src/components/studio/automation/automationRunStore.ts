import { get, set, del } from 'idb-keyval';
import type { AutomationRunState } from './automationTypes';

/** Keyed by chapter, separate from `studioProjectStore.ts`'s versioned layer/TypeR persistence —
 *  a run's progress is transient session state, not part of the chapter's own schema-versioned
 *  document, so it gets its own unversioned idb-keyval slot instead of joining that migration
 *  chain. */
function runKey(chapterId: string) {
  return `automation_run_${chapterId}`;
}

export async function loadAutomationRun(chapterId: string): Promise<AutomationRunState | null> {
  const data = await get<AutomationRunState>(runKey(chapterId));
  return data ?? null;
}

export async function saveAutomationRun(state: AutomationRunState): Promise<void> {
  await set(runKey(state.chapterId), state);
}

export async function clearAutomationRun(chapterId: string): Promise<void> {
  await del(runKey(chapterId));
}
