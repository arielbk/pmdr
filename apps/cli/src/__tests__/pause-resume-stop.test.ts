import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, deriveState } from "../state.js";
import { pauseTimer } from "../commands/pause.js";
import { resumeTimer } from "../commands/resume.js";
import { stopTimer } from "../commands/stop.js";

const NOW = 1_000_000;

function makeStore(dir: string) {
  return createStateModule(dir);
}

describe("pauseTimer", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when idle (no state file)", () => {
    expect(() => pauseTimer({ store, now: NOW })).toThrow(/No timer is running/);
  });

  it("sets pausedAt on a running timer", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    pauseTimer({ store, now: NOW });
    expect(store.readState()).toMatchObject({ pausedAt: NOW });
  });

  it("preserves other fields when pausing", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    pauseTimer({ store, now: NOW });
    expect(store.readState()).toEqual({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: NOW,
      accumulatedPauseMs: 0,
    });
  });

  it("throws when already paused", () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
    });
    expect(() => pauseTimer({ store, now: NOW })).toThrow(/already paused/i);
  });

  it("advances an expired focus to a born-paused break; pausing it again throws", () => {
    // focus expired 10s ago → break is born paused at the completion moment,
    // so it is already paused and pauseTimer rejects it.
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() => pauseTimer({ store, now: NOW })).toThrow(/already paused/i);
    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.pausedAt).toBe(NOW - 10_000); // born paused at focus completion
    const completionsFile = join(tmpDir, "completions.jsonl");
    expect(existsSync(completionsFile)).toBe(true);
  });

  it("pausing a running break stops it — state cleared to idle", () => {
    store.writeState({
      startedAt: NOW - 30_000,
      durationMs: 300_000, // 5 min break, still running
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "break",
    });
    pauseTimer({ store, now: NOW });
    expect(store.readState()).toBeNull();
    const derived = deriveState({ file: store.readState(), now: NOW });
    expect(derived.kind).toBe("idle");
  });

  it("pausing a running break logs a stop event, not a pause event", () => {
    store.writeState({
      startedAt: NOW - 30_000,
      durationMs: 300_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "break",
      id: "test-break-id",
    });
    pauseTimer({ store, now: NOW });
    const events = store.readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("stop");
    expect(events[0]!.id).toBe("test-break-id");
  });

  it("pausing a running break does NOT log a pause event", () => {
    store.writeState({
      startedAt: NOW - 30_000,
      durationMs: 300_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "break",
      id: "test-break-id",
    });
    pauseTimer({ store, now: NOW });
    const events = store.readEvents();
    expect(events.every((e) => e.type !== "pause")).toBe(true);
  });

  it("pausing a running break does NOT append a completion", () => {
    store.writeState({
      startedAt: NOW - 30_000,
      durationMs: 300_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "break",
    });
    pauseTimer({ store, now: NOW });
    const completionsFile = join(tmpDir, "completions.jsonl");
    expect(existsSync(completionsFile)).toBe(false);
  });

  it("pausing a running focus block still sets pausedAt (regression)", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      phase: "focus",
    });
    pauseTimer({ store, now: NOW });
    expect(store.readState()).toMatchObject({ pausedAt: NOW });
  });
});

describe("resumeTimer", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when idle (no state file)", () => {
    expect(() => resumeTimer({ store, now: NOW })).toThrow(/No timer is running/);
  });

  it("throws when already running", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() => resumeTimer({ store, now: NOW })).toThrow(/already running/i);
  });

  it("clears pausedAt and accumulates pause duration", () => {
    const pausedAt = NOW - 10_000;
    store.writeState({
      startedAt: NOW - 20_000,
      durationMs: 60_000,
      pausedAt,
      accumulatedPauseMs: 0,
    });
    resumeTimer({ store, now: NOW });
    expect(store.readState()).toEqual({
      startedAt: NOW - 20_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 10_000,
    });
  });

  it("adds to existing accumulatedPauseMs on second resume", () => {
    store.writeState({
      startedAt: NOW - 30_000,
      durationMs: 60_000,
      pausedAt: NOW - 5_000,
      accumulatedPauseMs: 8_000,
    });
    resumeTimer({ store, now: NOW });
    expect(store.readState()).toMatchObject({ accumulatedPauseMs: 13_000, pausedAt: null });
  });

  it("advances an expired focus to a born-paused break; resume starts the pending break", () => {
    // focus expired → break is born paused; resume is the start affordance and
    // succeeds, leaving the break running.
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(() => resumeTimer({ store, now: NOW })).not.toThrow();
    const file = store.readState();
    expect(file?.phase).toBe("break");
    expect(file?.pausedAt).toBeNull(); // now running
  });

  it("resuming a pending break shifts its end: the full duration runs from the resume moment", () => {
    // focus expired 10s ago → pending break born paused at NOW-10_000. Resuming
    // at NOW counts those 10s as pause time, so the break still has its full
    // 5 minutes ahead of it.
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    resumeTimer({ store, now: NOW });
    const file = store.readState();
    expect(file?.accumulatedPauseMs).toBe(10_000);
    const derived = deriveState({ file, now: NOW });
    expect(derived).toMatchObject({
      kind: "running",
      remainingMs: 5 * 60 * 1000,
    });
  });
});

describe("stopTimer", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false and is a no-op when idle", () => {
    expect(stopTimer({ store })).toBe(false);
    expect(store.readState()).toBeNull();
  });

  it("clears state when running and returns true", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    expect(stopTimer({ store })).toBe(true);
    expect(store.readState()).toBeNull();
  });

  it("clears state when paused and returns true", () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
    });
    expect(stopTimer({ store })).toBe(true);
    expect(store.readState()).toBeNull();
  });

  it("does NOT append a completion when stopping a running timer", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    stopTimer({ store });
    const completionsFile = join(tmpDir, "completions.jsonl");
    expect(existsSync(completionsFile)).toBe(false);
  });

  it("does NOT append a completion when stopping a paused timer", () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
    });
    stopTimer({ store });
    const completionsFile = join(tmpDir, "completions.jsonl");
    expect(existsSync(completionsFile)).toBe(false);
  });
});
