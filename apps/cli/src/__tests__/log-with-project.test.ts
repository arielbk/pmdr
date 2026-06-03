import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import type { CompletionWrite } from "../state.js";

const NOW = new Date("2024-01-15T12:00:00").getTime();

function todayTs(offsetMs = 0): number {
  return new Date("2024-01-15T09:00:00").getTime() + offsetMs;
}

function yestTs(): number {
  return new Date("2024-01-14T23:00:00").getTime();
}

// ─── appendCompletion writes project ─────────────────────────────────────────

describe("appendCompletion with project", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-lwp-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a JSONL line that includes the project field", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "test-project" });
    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const line = JSON.parse(raw.trim());
    expect(line.project).toBe("test-project");
    expect(line.completedAt).toBe(todayTs());
    expect(line.durationMs).toBe(60_000);
  });

  it("CompletionWrite type requires project (compile-time contract verified at runtime)", () => {
    const write: CompletionWrite = { completedAt: todayTs(), durationMs: 60_000, project: "pmdr" };
    expect(write.project).toBe("pmdr");
  });

  it("appends multiple entries each with their own project", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: todayTs(1000), durationMs: 60_000, project: "proj-b" });
    const raw = readFileSync(join(tmpDir, "completions.jsonl"), "utf8");
    const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]!.project).toBe("proj-a");
    expect(lines[1]!.project).toBe("proj-b");
  });
});

// ─── readToday grouping ───────────────────────────────────────────────────────

describe("readToday grouping", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-lwp-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when no completions file exists", () => {
    expect(store.readToday(NOW)).toEqual({});
  });

  it("groups entries by project name", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: todayTs(1000), durationMs: 60_000, project: "proj-b" });
    store.appendCompletion({ completedAt: todayTs(2000), durationMs: 60_000, project: "proj-a" });
    const groups = store.readToday(NOW);
    expect(groups["proj-a"]).toHaveLength(2);
    expect(groups["proj-b"]).toHaveLength(1);
  });

  it("groups legacy entries without project under (unassigned)", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "completions.jsonl"),
      JSON.stringify({ completedAt: todayTs(), durationMs: 60_000 }) + "\n",
    );
    const groups = store.readToday(NOW);
    expect(groups["(unassigned)"]).toHaveLength(1);
  });

  it("mixed log: project entries and legacy entries grouped correctly", () => {
    mkdirSync(tmpDir, { recursive: true });
    const lines = [
      JSON.stringify({ completedAt: todayTs(), durationMs: 60_000, project: "pmdr" }),
      JSON.stringify({ completedAt: todayTs(1000), durationMs: 60_000 }),
      JSON.stringify({ completedAt: todayTs(2000), durationMs: 60_000, project: "pmdr" }),
    ].join("\n") + "\n";
    writeFileSync(join(tmpDir, "completions.jsonl"), lines);
    const groups = store.readToday(NOW);
    expect(groups["pmdr"]).toHaveLength(2);
    expect(groups["(unassigned)"]).toHaveLength(1);
  });

  it("only includes today's entries (local-date boundary)", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: yestTs(), durationMs: 60_000, project: "proj-a" });
    const groups = store.readToday(NOW);
    expect(groups["proj-a"]).toHaveLength(1);
  });

  it("excludes future entries", () => {
    const futureTs = new Date("2024-01-16T09:00:00").getTime();
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: futureTs, durationMs: 60_000, project: "proj-a" });
    const groups = store.readToday(NOW);
    expect(groups["proj-a"]).toHaveLength(1);
  });

  it("advances an expired focus to break and includes the focus completion in groups", () => {
    const startedAt = NOW - 70_000;
    store.writeState({ startedAt, durationMs: 60_000, pausedAt: null, accumulatedPauseMs: 0 });
    const groups = store.readToday(NOW);
    expect(groups["(unassigned)"]).toHaveLength(1);
    // State is now a born-paused (pending) break after auto-advancing
    expect(store.readState()?.phase).toBe("break");
  });
});
