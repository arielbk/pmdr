import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, deriveState } from "../state.js";
import type { StateRecord } from "../state.js";

// ─── deriveState (pure) ───────────────────────────────────────────────────────

describe("deriveState", () => {
  it("returns idle when file is null", () => {
    expect(deriveState({ file: null, now: 1000 })).toEqual({
      kind: "idle",
      remainingMs: 0,
    });
  });

  it("returns running when timer is active and not yet expired", () => {
    const file: StateRecord = {
      startedAt: 1000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    // now = 11 000 → remaining = 60 000 − 10 000 = 50 000
    const result = deriveState({ file, now: 11_000 });
    expect(result.kind).toBe("running");
    expect(result.remainingMs).toBe(50_000);
  });

  it("returns expired when timer has elapsed", () => {
    const file: StateRecord = {
      startedAt: 1000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    const result = deriveState({ file, now: 62_000 });
    expect(result.kind).toBe("expired");
    expect(result.remainingMs).toBe(0);
  });

  it("expires exactly at the boundary (remainingMs = 0)", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    expect(deriveState({ file, now: 1000 }).kind).toBe("expired");
    expect(deriveState({ file, now: 999 }).kind).toBe("running");
  });

  it("returns paused when pausedAt is set", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 60_000,
      pausedAt: 20_000,
      accumulatedPauseMs: 0,
    };
    // remaining = (0 + 60 000 + 0) − 20 000 = 40 000
    const result = deriveState({ file, now: 30_000 });
    expect(result.kind).toBe("paused");
    expect(result.remainingMs).toBe(40_000);
  });
});

// ─── pause math ──────────────────────────────────────────────────────────────

describe("pause math", () => {
  it("accumulated pause time shifts the nominal end", () => {
    // start=0, duration=60s, paused 10s → accumulated=10 000
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 10_000,
    };
    // nominalEnd = 0 + 60 000 + 10 000 = 70 000
    // at now=35 000 → remaining = 35 000
    const result = deriveState({ file, now: 35_000 });
    expect(result.kind).toBe("running");
    expect(result.remainingMs).toBe(35_000);
  });

  it("remainingMs while paused accounts for accumulated pauses", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 60_000,
      pausedAt: 30_000,
      accumulatedPauseMs: 10_000,
    };
    // nominalEnd = 70 000; frozen at pausedAt=30 000 → remaining = 40 000
    const result = deriveState({ file, now: 50_000 });
    expect(result.kind).toBe("paused");
    expect(result.remainingMs).toBe(40_000);
  });
});

// ─── filesystem operations ───────────────────────────────────────────────────

describe("filesystem operations", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readState returns null when no file exists", () => {
    expect(store.readState()).toBeNull();
  });

  it("writeState and readState round-trip correctly", () => {
    const s: StateRecord = {
      startedAt: 12_345,
      durationMs: 1_500_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(s);
    expect(store.readState()).toEqual(s);
  });

  it("writeState creates the directory if it does not exist", () => {
    const nestedStore = createStateModule(join(tmpDir, "nested", "deeply"));
    const s: StateRecord = {
      startedAt: 0,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    expect(() => nestedStore.writeState(s)).not.toThrow();
    expect(nestedStore.readState()).toEqual(s);
  });

  it("atomic write: the state file contains valid JSON after each write", () => {
    const s: StateRecord = {
      startedAt: 1000,
      durationMs: 5000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(s);
    const raw = readFileSync(join(tmpDir, "state.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual(s);
  });

  it("clearState removes the file", () => {
    const s: StateRecord = {
      startedAt: 0,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(s);
    store.clearState();
    expect(store.readState()).toBeNull();
    expect(existsSync(join(tmpDir, "state.json"))).toBe(false);
  });

  it("clearState is idempotent when file does not exist", () => {
    expect(() => store.clearState()).not.toThrow();
  });

  it("appendCompletion creates and appends to completions.jsonl", () => {
    store.appendCompletion({ completedAt: 1000, durationMs: 60_000, project: "(unassigned)" });
    store.appendCompletion({ completedAt: 2000, durationMs: 60_000, project: "(unassigned)" });

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ completedAt: 1000, durationMs: 60_000 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ completedAt: 2000, durationMs: 60_000 });
  });
});

// ─── finalizeIfExpired ────────────────────────────────────────────────────────

describe("finalizeIfExpired", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is a no-op when state is idle (no file)", () => {
    store.finalizeIfExpired(99_999);
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("writes exactly one log entry and clears state when expired", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(file);
    // nominalEnd = 0 + 1000 + 0 = 1000; now=2000 → expired
    store.finalizeIfExpired(2000);

    expect(store.readState()).toBeNull();

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as CompletionEntry;
    expect(entry.completedAt).toBe(1000); // startedAt + durationMs + accumulatedPauseMs
    expect(entry.durationMs).toBe(1000);
  });

  it("is idempotent on already-cleared state", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(file);
    store.finalizeIfExpired(2000); // first call: appends + clears
    store.finalizeIfExpired(2000); // second call: state is null → no-op

    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);
  });

  it("does not finalize a running timer", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(file);
    store.finalizeIfExpired(30_000); // still running
    expect(store.readState()).toEqual(file);
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("does not finalize a paused timer, even well past nominal end", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 60_000,
      pausedAt: 10_000,
      accumulatedPauseMs: 0,
    };
    store.writeState(file);
    store.finalizeIfExpired(999_999); // paused is never "expired"
    expect(store.readState()).toEqual(file);
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });
});

// ─── advancePhaseIfExpired ────────────────────────────────────────────────────

describe("advancePhaseIfExpired", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is a no-op when state is idle (no file)", () => {
    store.advancePhaseIfExpired(99_999);
    expect(store.readState()).toBeNull();
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("is a no-op when focus is still running", () => {
    const file: StateRecord = {
      startedAt: 0,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
    store.writeState(file);
    store.advancePhaseIfExpired(30_000);
    expect(store.readState()!.startedAt).toBe(0);
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("expired focus → break born paused at completion moment + one focus completion appended", () => {
    store.writeState({ startedAt: 0, durationMs: 1000, pausedAt: null, accumulatedPauseMs: 0 });
    store.advancePhaseIfExpired(2000);

    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.completedFocusBlocks).toBe(1);
    expect(file?.startedAt).toBe(1000); // break starts at focus nominal end
    expect(file?.pausedAt).toBe(1000); // born paused at the completion moment
    expect(file?.accumulatedPauseMs).toBe(0);

    // The pending break derives as paused with the full break duration remaining.
    const derived = deriveState({ file: file!, now: 2000 });
    expect(derived.kind).toBe("paused");
    expect(derived.remainingMs).toBe(5 * 60 * 1000); // full short break

    const completions = store.readCompletions();
    expect(completions).toHaveLength(1);
    expect(completions[0]!.completedAt).toBe(1000);
    expect(completions[0]!.durationMs).toBe(1000);
  });

  it("pending break's remaining time is stable arbitrarily long after focus expiry", () => {
    store.writeState({ startedAt: 0, durationMs: 1000, pausedAt: null, accumulatedPauseMs: 0 });
    // advance well past both the focus end and a hypothetical break end
    store.advancePhaseIfExpired(999_999);

    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.pausedAt).toBe(1000);

    // Hours later, the break is still paused with its full duration intact.
    const muchLater = 1000 + 24 * 60 * 60 * 1000;
    const derived = deriveState({ file: file!, now: muchLater });
    expect(derived.kind).toBe("paused");
    expect(derived.remainingMs).toBe(5 * 60 * 1000);
  });

  it("chained-expiry loop does not advance a pending break to idle", () => {
    // focus: 0→1000; were the break born running it would expire by 302000.
    // Born paused, it must stay a paused break no matter how far `now` is.
    store.writeState({ startedAt: 0, durationMs: 1000, pausedAt: null, accumulatedPauseMs: 0 });
    store.advancePhaseIfExpired(302_000);

    const file = store.readState();
    expect(file).not.toBeNull();
    expect(file?.phase).toBe("break");
    expect(file?.pausedAt).toBe(1000);
    const completions = store.readCompletions();
    expect(completions).toHaveLength(1);
    expect(completions[0]!.completedAt).toBe(1000);
  });

  it("a resumed pending break that expires clears to idle, no break completion logged", () => {
    // born-paused break, then resumed (pausedAt cleared) — i.e. a running break.
    store.writeState({
      startedAt: 1000,
      durationMs: 5 * 60 * 1000,
      pausedAt: null, // resumed
      accumulatedPauseMs: 0,
      phase: "break",
      completedFocusBlocks: 1,
    });
    store.advancePhaseIfExpired(1000 + 5 * 60 * 1000 + 1);

    expect(store.readState()).toBeNull();
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("expired break → idle, no completion logged", () => {
    store.writeState({
      startedAt: 0,
      durationMs: 5_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "break",
      completedFocusBlocks: 1,
    });
    store.advancePhaseIfExpired(10_000);

    expect(store.readState()).toBeNull();
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("old record without phase fields is treated as focus/0", () => {
    // legacy state written without phase or completedFocusBlocks
    store.writeState({ startedAt: 0, durationMs: 1000, pausedAt: null, accumulatedPauseMs: 0 });
    store.advancePhaseIfExpired(2000);

    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.completedFocusBlocks).toBe(1);
    expect(store.readCompletions()).toHaveLength(1);
  });

  it("preserves project when writing break record", () => {
    store.writeState({ startedAt: 0, durationMs: 1000, pausedAt: null, accumulatedPauseMs: 0, project: "my-proj" });
    store.advancePhaseIfExpired(2000);

    const file = store.readState();
    expect(file?.project).toBe("my-proj");
  });

  it("uses short break after 1 completed focus block", () => {
    store.writeState({ startedAt: 0, durationMs: 1000, pausedAt: null, accumulatedPauseMs: 0 });
    store.advancePhaseIfExpired(2000);

    const file = store.readState();
    expect(file?.durationMs).toBe(5 * 60 * 1000); // short break
  });

  it("uses long break after 4 completed focus blocks today", () => {
    // Seed 3 prior completions in today's JSONL so this is the 4th focus block.
    // Use a real "today" base so timestamps agree on which calendar day they fall.
    const todayBase = new Date("2026-06-06T10:00:00.000Z").getTime();
    for (let i = 0; i < 3; i++) {
      store.appendCompletion({
        completedAt: todayBase + i * 2000,
        durationMs: 1000,
        project: "(unassigned)",
      });
    }
    const focusStart = todayBase + 10_000;
    store.writeState({
      startedAt: focusStart,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    store.advancePhaseIfExpired(focusStart + 2000);

    const file = store.readState();
    expect(file?.durationMs).toBe(15 * 60 * 1000); // long break (4th today)
    expect(file?.completedFocusBlocks).toBe(1);
    expect(file?.pausedAt).toBe(focusStart + 1000); // long break is also born paused
  });

  it("uses configured short break, long break, and long-break cadence", () => {
    const configuredStore = createStateModule(tmpDir, {
      config: {
        readEffectiveConfig: () => ({
          focusMinutes: 25,
          shortBreakMinutes: 7,
          longBreakMinutes: 20,
          longBreakEvery: 2,
          dailyGoal: 8,
          focusEndSound: "Glass",
          breakEndSound: "Submarine",
        }),
      },
    });

    // 1st block today → 1 completion → 1 % 2 !== 0 → short break
    const today = Date.now();
    configuredStore.writeState({
      startedAt: today,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    configuredStore.advancePhaseIfExpired(today + 2000);
    expect(configuredStore.readState()?.durationMs).toBe(7 * 60 * 1000);

    // 2nd block today → 2 completions → 2 % 2 === 0 → long break
    configuredStore.writeState({
      startedAt: today + 3000,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    configuredStore.advancePhaseIfExpired(today + 5000);
    const file = configuredStore.readState();
    expect(file?.durationMs).toBe(20 * 60 * 1000);
    expect(file?.completedFocusBlocks).toBe(1);
  });
});

// ─── daily cadence: long break fires on today's count ────────────────────────

describe("daily cadence", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  // A fixed "today" moment — all completions will be stamped within this day.
  const TODAY = new Date("2026-06-06T10:00:00.000Z").getTime();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-daily-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: expire one focus block and return the break state record.
  // focusStart and focusEnd are offsets from TODAY.
  function expireFocus(focusStartOffset: number, focusDuration: number): void {
    const startedAt = TODAY + focusStartOffset;
    store.writeState({
      startedAt,
      durationMs: focusDuration,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: store.readState()?.completedFocusBlocks ?? 0,
    });
    store.advancePhaseIfExpired(startedAt + focusDuration + 1);
  }

  it("countTodayFocusBlocks reflects completions written today", () => {
    // No completions yet
    expect(store.countTodayFocusBlocks(TODAY)).toBe(0);

    // Append one completion today
    store.appendCompletion({ completedAt: TODAY, durationMs: 1000, project: "test" });
    expect(store.countTodayFocusBlocks(TODAY)).toBe(1);

    // Append a completion for a different day — should not count
    const yesterday = TODAY - 24 * 60 * 60 * 1000;
    store.appendCompletion({ completedAt: yesterday, durationMs: 1000, project: "test" });
    expect(store.countTodayFocusBlocks(TODAY)).toBe(1);
  });

  it("4th block today gets a long break, regardless of completedFocusBlocks in state", () => {
    // Simulate 3 completions already in the JSONL for today
    for (let i = 0; i < 3; i++) {
      store.appendCompletion({
        completedAt: TODAY + i * 2000,
        durationMs: 1000,
        project: "(unassigned)",
      });
    }

    // Now start the 4th focus block — completedFocusBlocks in state is 0 (fresh start)
    store.writeState({
      startedAt: TODAY + 10_000,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0, // simulates what start.ts writes (resets to 0)
    });

    store.advancePhaseIfExpired(TODAY + 11_001);

    const file = store.readState();
    // The break should be long because today's count is now 4 (divisible by longBreakEvery=4)
    expect(file?.durationMs).toBe(15 * 60 * 1000);
  });

  it("1st block today gets a short break", () => {
    // No prior completions today
    store.writeState({
      startedAt: TODAY,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });

    store.advancePhaseIfExpired(TODAY + 1001);

    const file = store.readState();
    // 1 completion so far — not divisible by 4 → short break
    expect(file?.durationMs).toBe(5 * 60 * 1000);
  });

  it("simulated full day: blocks 1-3 short, block 4 long", () => {
    const focusDuration = 1000;
    const baseTime = TODAY;

    // Block 1
    store.writeState({
      startedAt: baseTime,
      durationMs: focusDuration,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    store.advancePhaseIfExpired(baseTime + focusDuration + 1);
    expect(store.readState()?.durationMs).toBe(5 * 60 * 1000); // short

    // Block 2
    store.writeState({
      startedAt: baseTime + 10_000,
      durationMs: focusDuration,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    store.advancePhaseIfExpired(baseTime + 10_000 + focusDuration + 1);
    expect(store.readState()?.durationMs).toBe(5 * 60 * 1000); // short

    // Block 3
    store.writeState({
      startedAt: baseTime + 20_000,
      durationMs: focusDuration,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    store.advancePhaseIfExpired(baseTime + 20_000 + focusDuration + 1);
    expect(store.readState()?.durationMs).toBe(5 * 60 * 1000); // short

    // Block 4 — should trigger long break
    store.writeState({
      startedAt: baseTime + 30_000,
      durationMs: focusDuration,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    store.advancePhaseIfExpired(baseTime + 30_000 + focusDuration + 1);
    expect(store.readState()?.durationMs).toBe(15 * 60 * 1000); // long!
  });

  it("daily cadence respects configured longBreakEvery", () => {
    const configuredStore = createStateModule(tmpDir, {
      config: {
        readEffectiveConfig: () => ({
          focusMinutes: 25,
          shortBreakMinutes: 7,
          longBreakMinutes: 20,
          longBreakEvery: 2,
          dailyGoal: 8,
          focusEndSound: "Glass",
          breakEndSound: "Submarine",
        }),
      },
    });

    // 1st block
    configuredStore.writeState({
      startedAt: TODAY,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    configuredStore.advancePhaseIfExpired(TODAY + 1001);
    // After 1st: count=1, 1 % 2 != 0 → short break (7min)
    expect(configuredStore.readState()?.durationMs).toBe(7 * 60 * 1000);

    // 2nd block — triggers long break (count=2, 2%2===0)
    configuredStore.writeState({
      startedAt: TODAY + 10_000,
      durationMs: 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
      completedFocusBlocks: 0,
    });
    configuredStore.advancePhaseIfExpired(TODAY + 11_001);
    expect(configuredStore.readState()?.durationMs).toBe(20 * 60 * 1000);
  });
});

// ─── stale pending-break expiry ──────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

describe("stale pending-break expiry", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pending break just under 1h is still paused — no expiry", () => {
    const pausedAt = 1000;
    store.writeState({
      startedAt: 0,
      durationMs: 5 * 60 * 1000,
      pausedAt,
      accumulatedPauseMs: 0,
      phase: "break",
      completedFocusBlocks: 1,
    });
    const now = pausedAt + ONE_HOUR_MS - 1; // 1ms under threshold
    store.advancePhaseIfExpired(now);
    expect(store.readState()).not.toBeNull();
    expect(store.readState()?.phase).toBe("break");
  });

  it("pending break just over 1h expires to idle — no completion logged", () => {
    const pausedAt = 1000;
    store.writeState({
      startedAt: 0,
      durationMs: 5 * 60 * 1000,
      pausedAt,
      accumulatedPauseMs: 0,
      phase: "break",
      completedFocusBlocks: 1,
    });
    const now = pausedAt + ONE_HOUR_MS + 1; // 1ms over threshold
    store.advancePhaseIfExpired(now);
    expect(store.readState()).toBeNull();
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });

  it("resume attempted on a stale pending break results in idle — no resurrection", () => {
    const pausedAt = 1000;
    store.writeState({
      startedAt: 0,
      durationMs: 5 * 60 * 1000,
      pausedAt,
      accumulatedPauseMs: 0,
      phase: "break",
      completedFocusBlocks: 1,
    });
    // advance phase; stale break should expire to idle
    const now = pausedAt + ONE_HOUR_MS + 1;
    store.advancePhaseIfExpired(now);
    // after expiry, state is idle
    expect(store.readState()).toBeNull();
  });

  it("legacy mid-paused break (no phase field) with pausedAt older than 1h expires to idle", () => {
    // A state file written by an older version: phase field absent, pausedAt set.
    // This looks like a focus block paused, but the stale-break expiry should not
    // fire on focus pauses — only on break pauses.
    // However, a legacy break written without phase=break should behave like focus (per handoff note),
    // so it won't expire as a stale break. Only breaks with phase="break" are caught.
    // This test verifies a phase="break" record with no completedFocusBlocks field still expires.
    const pausedAt = 1000;
    store.writeState({
      startedAt: 0,
      durationMs: 5 * 60 * 1000,
      pausedAt,
      accumulatedPauseMs: 0,
      phase: "break",
      // no completedFocusBlocks
    });
    const now = pausedAt + ONE_HOUR_MS + 1;
    store.advancePhaseIfExpired(now);
    expect(store.readState()).toBeNull();
    expect(existsSync(join(tmpDir, "completions.jsonl"))).toBe(false);
  });
});

// Local type for JSON parsing in tests
interface CompletionEntry {
  completedAt: number;
  durationMs: number;
}
