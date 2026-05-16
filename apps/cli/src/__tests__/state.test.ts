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

// Local type for JSON parsing in tests
interface CompletionEntry {
  completedAt: number;
  durationMs: number;
}
