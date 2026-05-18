import type { StateRecord, createStateModule } from "../state.js";
import { deriveState } from "../state.js";

export type Phase = "focus" | "break";

export interface DerivedPhaseState {
  phase: Phase;
  remainingMs: number;
  completedFocusBlocks: number;
  paused: boolean;
}

type StoreLike = Pick<ReturnType<typeof createStateModule>, "readToday">;

function countTodayFocusBlocks(
  store: StoreLike | undefined,
  now: number,
  fallback: number,
): number {
  if (!store) return fallback;
  try {
    const groups = store.readToday(now);
    let total = 0;
    for (const key of Object.keys(groups)) {
      total += groups[key]!.length;
    }
    return total;
  } catch {
    return fallback;
  }
}

export function derivePhaseState(
  record: StateRecord | null,
  now: number,
  store?: StoreLike,
): DerivedPhaseState {
  if (!record) {
    return {
      phase: "focus",
      remainingMs: 25 * 60 * 1000,
      completedFocusBlocks: countTodayFocusBlocks(store, now, 0),
      paused: false,
    };
  }

  const derived = deriveState({ file: record, now });
  return {
    phase: record.phase ?? "focus",
    remainingMs: derived.remainingMs,
    completedFocusBlocks: countTodayFocusBlocks(
      store,
      now,
      record.completedFocusBlocks ?? 0,
    ),
    paused: derived.kind === "paused",
  };
}
