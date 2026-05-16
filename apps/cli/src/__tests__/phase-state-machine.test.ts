import { describe, it, expect } from "vitest";
import { createPhaseStateMachine } from "../tui/phase-state-machine.js";
import type { PhaseCompleteEvent } from "../tui/phase-state-machine.js";

describe("phase-state-machine — initial state", () => {
  it("starts in focus phase with full duration", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    const st = m.getState(0);
    expect(st.phase).toBe("focus");
    expect(st.remainingMs).toBe(10_000);
    expect(st.completedFocusBlocks).toBe(0);
    expect(st.paused).toBe(false);
  });
});

describe("phase-state-machine — tick()", () => {
  it("does not transition before the phase ends", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 1000 });
    m.tick(999);
    expect(m.getState(999).phase).toBe("focus");
  });

  it("transitions focus → break at phase end", () => {
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      shortBreakDurationMs: 500,
    });
    m.tick(1000);
    const st = m.getState(1000);
    expect(st.phase).toBe("break");
    expect(st.remainingMs).toBe(500);
    expect(st.completedFocusBlocks).toBe(1);
  });

  it("transitions break → focus at phase end", () => {
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      shortBreakDurationMs: 500,
    });
    m.tick(1000);
    m.tick(1500);
    const st = m.getState(1500);
    expect(st.phase).toBe("focus");
    expect(st.completedFocusBlocks).toBe(1);
  });

  it("does not tick while paused", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 1000 });
    m.pause(500);
    m.tick(2000);
    expect(m.getState(2000).phase).toBe("focus");
  });
});

describe("phase-state-machine — pause() and resume()", () => {
  it("paused state is reflected in getState", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    m.pause(5000);
    expect(m.getState(5000).paused).toBe(true);
  });

  it("remainingMs is frozen while paused", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    m.pause(3000);
    expect(m.getState(3000).remainingMs).toBe(7000);
    expect(m.getState(9000).remainingMs).toBe(7000);
  });

  it("accumulated pause time extends the phase duration", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    m.pause(3000);
    m.resume(8000); // paused for 5000ms
    // nominalEnd = 0 + 10000 + 5000 = 15000
    expect(m.getState(8000).remainingMs).toBe(7000);
  });

  it("resume() is idempotent when not paused", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    expect(() => m.resume(5000)).not.toThrow();
    expect(m.getState(5000).paused).toBe(false);
  });

  it("pause() twice doesn't double-count", () => {
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    m.pause(3000);
    m.pause(5000); // no-op
    m.resume(6000); // accumulated = 6000 - 3000 = 3000
    // nominalEnd = 0 + 10000 + 3000 = 13000; at 6000 → remaining = 7000
    expect(m.getState(6000).remainingMs).toBe(7000);
  });
});

describe("phase-state-machine — skip()", () => {
  it("skip() from focus transitions to break immediately", () => {
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 10_000,
      shortBreakDurationMs: 5_000,
    });
    m.skip(3000);
    const st = m.getState(3000);
    expect(st.phase).toBe("break");
    expect(st.completedFocusBlocks).toBe(1);
    expect(st.remainingMs).toBe(5_000);
  });

  it("skip() from break transitions to focus immediately", () => {
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 10_000,
      shortBreakDurationMs: 5_000,
    });
    m.skip(3000);
    m.skip(4000);
    const st = m.getState(4000);
    expect(st.phase).toBe("focus");
  });

  it("skip() emits phase-complete event", () => {
    const events: PhaseCompleteEvent[] = [];
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    m.on("phase-complete", (e) => events.push(e));
    m.skip(3000);
    expect(events).toHaveLength(1);
    expect(events[0]!.phase).toBe("focus");
  });

  it("skip() completedAt equals the skip time", () => {
    const events: PhaseCompleteEvent[] = [];
    const m = createPhaseStateMachine(0, { focusDurationMs: 10_000 });
    m.on("phase-complete", (e) => events.push(e));
    m.skip(3000);
    expect(events[0]!.completedAt).toBe(3000);
  });
});

describe("phase-state-machine — phase-complete events", () => {
  it("emits on natural focus completion", () => {
    const events: PhaseCompleteEvent[] = [];
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      shortBreakDurationMs: 500,
    });
    m.on("phase-complete", (e) => events.push(e));
    m.tick(1000);
    expect(events).toHaveLength(1);
    expect(events[0]!.phase).toBe("focus");
    expect(events[0]!.durationMs).toBe(1000);
  });

  it("completedAt is the nominal end time when tick detects late", () => {
    const events: PhaseCompleteEvent[] = [];
    const m = createPhaseStateMachine(0, { focusDurationMs: 1000 });
    m.on("phase-complete", (e) => events.push(e));
    m.tick(1500); // detected late
    expect(events[0]!.completedAt).toBe(1000);
  });

  it("completion event includes project when set", () => {
    const events: PhaseCompleteEvent[] = [];
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      project: "my-project",
    });
    m.on("phase-complete", (e) => events.push(e));
    m.tick(1000);
    expect(events[0]!.project).toBe("my-project");
  });

  it("focus completion matches state.ts CompletionWrite contract", () => {
    const completions: Array<{
      completedAt: number;
      durationMs: number;
      project: string;
    }> = [];
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      project: "my-project",
    });
    m.on("phase-complete", (e) => {
      if (e.phase === "focus") {
        completions.push({
          completedAt: e.completedAt,
          durationMs: e.durationMs,
          project: e.project ?? "(unassigned)",
        });
      }
    });
    m.tick(1000);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toEqual({
      completedAt: 1000,
      durationMs: 1000,
      project: "my-project",
    });
  });
});

describe("phase-state-machine — cycling", () => {
  it("completes two full cycles correctly", () => {
    const events: PhaseCompleteEvent[] = [];
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      shortBreakDurationMs: 500,
      longBreakAfter: 4,
    });
    m.on("phase-complete", (e) => events.push(e));

    m.tick(1000); // focus 1 ends
    m.tick(1500); // break 1 ends
    m.tick(2500); // focus 2 ends

    expect(events).toHaveLength(3);
    expect(events[0]!.phase).toBe("focus");
    expect(events[1]!.phase).toBe("break");
    expect(events[2]!.phase).toBe("focus");
    expect(m.getState(2500).completedFocusBlocks).toBe(2);
  });

  it("uses long break after every Nth focus block", () => {
    const m = createPhaseStateMachine(0, {
      focusDurationMs: 1000,
      shortBreakDurationMs: 500,
      longBreakDurationMs: 2000,
      longBreakAfter: 2,
    });

    m.tick(1000); // focus 1 ends → short break (1 % 2 !== 0)
    expect(m.getState(1000).remainingMs).toBe(500);

    m.tick(1500); // break 1 ends → focus 2 starts
    m.tick(2500); // focus 2 ends → long break (2 % 2 === 0)
    expect(m.getState(2500).remainingMs).toBe(2000);
  });
});
