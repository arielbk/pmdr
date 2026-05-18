import type { StateRecord } from "../state.js";
import { deriveState } from "../state.js";

export type Phase = "focus" | "break";

export interface DerivedPhaseState {
  phase: Phase;
  remainingMs: number;
  completedFocusBlocks: number;
  paused: boolean;
}

export function derivePhaseState(
  record: StateRecord | null,
  now: number,
): DerivedPhaseState {
  if (!record) {
    return {
      phase: "focus",
      remainingMs: 25 * 60 * 1000,
      completedFocusBlocks: 0,
      paused: false,
    };
  }

  const derived = deriveState({ file: record, now });
  return {
    phase: record.phase ?? "focus",
    remainingMs: derived.remainingMs,
    completedFocusBlocks: record.completedFocusBlocks ?? 0,
    paused: derived.kind === "paused",
  };
}
