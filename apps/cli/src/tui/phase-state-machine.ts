export type Phase = "focus" | "break";

export interface PhaseCompleteEvent {
  type: "phase-complete";
  phase: Phase;
  completedAt: number;
  durationMs: number;
  project?: string;
}

export interface DerivedPhaseState {
  phase: Phase;
  remainingMs: number;
  completedFocusBlocks: number;
  paused: boolean;
}

export interface InitialMachineState {
  phase: Phase;
  phaseStartedAt: number;
  phaseDurationMs: number;
  pausedAt: number | null;
  accumulatedPauseMs: number;
  completedFocusBlocks: number;
  project: string | undefined;
}

export interface PhaseConfig {
  focusDurationMs?: number;
  shortBreakDurationMs?: number;
  longBreakDurationMs?: number;
  longBreakAfter?: number;
  project?: string;
  initialState?: InitialMachineState;
}

type Listener = (event: PhaseCompleteEvent) => void;

interface MachineState {
  phase: Phase;
  phaseStartedAt: number;
  phaseDurationMs: number;
  pausedAt: number | null;
  accumulatedPauseMs: number;
  completedFocusBlocks: number;
  project: string | undefined;
}

const DEFAULT_FOCUS_MS = 25 * 60 * 1000;
const DEFAULT_SHORT_BREAK_MS = 5 * 60 * 1000;
const DEFAULT_LONG_BREAK_MS = 15 * 60 * 1000;
const DEFAULT_LONG_BREAK_AFTER = 4;

export function createPhaseStateMachine(
  startNow: number,
  config: PhaseConfig = {},
) {
  const focusDurationMs = config.focusDurationMs ?? DEFAULT_FOCUS_MS;
  const shortBreakDurationMs =
    config.shortBreakDurationMs ?? DEFAULT_SHORT_BREAK_MS;
  const longBreakDurationMs =
    config.longBreakDurationMs ?? DEFAULT_LONG_BREAK_MS;
  const longBreakAfter = config.longBreakAfter ?? DEFAULT_LONG_BREAK_AFTER;

  const listeners: Listener[] = [];

  let s: MachineState = config.initialState ?? {
    phase: "focus",
    phaseStartedAt: startNow,
    phaseDurationMs: focusDurationMs,
    pausedAt: null,
    accumulatedPauseMs: 0,
    completedFocusBlocks: 0,
    project: config.project,
  };

  function nominalEnd(): number {
    return s.phaseStartedAt + s.phaseDurationMs + s.accumulatedPauseMs;
  }

  function computeRemainingMs(now: number): number {
    const end = nominalEnd();
    if (s.pausedAt !== null) {
      return Math.max(0, end - s.pausedAt);
    }
    return Math.max(0, end - now);
  }

  function breakDurationMs(blocksCompleted: number): number {
    return blocksCompleted % longBreakAfter === 0
      ? longBreakDurationMs
      : shortBreakDurationMs;
  }

  function emit(event: PhaseCompleteEvent): void {
    for (const l of listeners) l(event);
  }

  function doTransition(now: number, completedAt: number): void {
    const completedPhase = s.phase;
    const completedDurationMs = s.phaseDurationMs;

    if (completedPhase === "focus") {
      const newCount = s.completedFocusBlocks + 1;
      emit({
        type: "phase-complete",
        phase: "focus",
        completedAt,
        durationMs: completedDurationMs,
        project: s.project,
      });
      s = {
        phase: "break",
        phaseStartedAt: now,
        phaseDurationMs: breakDurationMs(newCount),
        pausedAt: null,
        accumulatedPauseMs: 0,
        completedFocusBlocks: newCount,
        project: s.project,
      };
    } else {
      emit({
        type: "phase-complete",
        phase: "break",
        completedAt,
        durationMs: completedDurationMs,
        project: s.project,
      });
      s = {
        phase: "focus",
        phaseStartedAt: now,
        phaseDurationMs: focusDurationMs,
        pausedAt: null,
        accumulatedPauseMs: 0,
        completedFocusBlocks: s.completedFocusBlocks,
        project: s.project,
      };
    }
  }

  return {
    tick(now: number): void {
      if (s.pausedAt !== null) return;
      if (computeRemainingMs(now) <= 0) {
        doTransition(now, nominalEnd());
      }
    },

    pause(now: number): void {
      if (s.pausedAt !== null) return;
      s = { ...s, pausedAt: now };
    },

    resume(now: number): void {
      if (s.pausedAt === null) return;
      const pauseDuration = now - s.pausedAt;
      s = {
        ...s,
        pausedAt: null,
        accumulatedPauseMs: s.accumulatedPauseMs + pauseDuration,
      };
    },

    skip(now: number): void {
      doTransition(now, now);
    },

    getState(now: number): DerivedPhaseState {
      return {
        phase: s.phase,
        remainingMs: computeRemainingMs(now),
        completedFocusBlocks: s.completedFocusBlocks,
        paused: s.pausedAt !== null,
      };
    },

    on(event: "phase-complete", listener: Listener): void {
      if (event === "phase-complete") listeners.push(listener);
    },

    setProject(project: string): void {
      s = { ...s, project };
    },
  };
}
