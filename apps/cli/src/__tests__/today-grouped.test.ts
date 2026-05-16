import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import {
  getTodayGrouped,
  formatTodayGrouped,
  type TodayGroupedResult,
} from "../commands/today.js";

const NOW = new Date("2024-01-15T12:00:00").getTime();

function todayTs(offsetMs = 0): number {
  return new Date("2024-01-15T09:00:00").getTime() + offsetMs;
}

function yestTs(): number {
  return new Date("2024-01-14T23:00:00").getTime();
}

// ─── getTodayGrouped ──────────────────────────────────────────────────────────

describe("getTodayGrouped", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-tg-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty groups and zero total when no completions", () => {
    const result = getTodayGrouped({ store, now: NOW });
    expect(result.groups).toHaveLength(0);
    expect(result.total.pomodoros).toBe(0);
    expect(result.total.totalMs).toBe(0);
  });

  it("groups entries by project with correct pomodoro count", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: todayTs(1000), durationMs: 60_000, project: "proj-b" });
    store.appendCompletion({ completedAt: todayTs(2000), durationMs: 60_000, project: "proj-a" });
    const result = getTodayGrouped({ store, now: NOW });
    const a = result.groups.find((g) => g.project === "proj-a")!;
    const b = result.groups.find((g) => g.project === "proj-b")!;
    expect(a.pomodoros).toBe(2);
    expect(b.pomodoros).toBe(1);
  });

  it("computes per-group totalMs correctly", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 1500_000, project: "pmdr" });
    store.appendCompletion({ completedAt: todayTs(1000), durationMs: 600_000, project: "pmdr" });
    const result = getTodayGrouped({ store, now: NOW });
    const g = result.groups[0]!;
    expect(g.totalMs).toBe(2100_000);
  });

  it("computes grand total across all groups", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 1500_000, project: "proj-a" });
    store.appendCompletion({ completedAt: todayTs(1000), durationMs: 600_000, project: "proj-b" });
    const result = getTodayGrouped({ store, now: NOW });
    expect(result.total.pomodoros).toBe(2);
    expect(result.total.totalMs).toBe(2100_000);
  });

  it("result shape matches contract { groups, total }", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 1500_000, project: "pmdr" });
    const result = getTodayGrouped({ store, now: NOW });
    expect(result).toMatchObject({
      groups: [
        {
          project: "pmdr",
          pomodoros: 1,
          totalMs: 1500_000,
          entries: expect.arrayContaining([
            expect.objectContaining({ completedAt: todayTs(), durationMs: 1500_000 }),
          ]),
        },
      ],
      total: { pomodoros: 1, totalMs: 1500_000 },
    });
  });

  it("filters to a single project when project option is provided", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: todayTs(1000), durationMs: 60_000, project: "proj-b" });
    const result = getTodayGrouped({ store, now: NOW, project: "proj-a" });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.project).toBe("proj-a");
    expect(result.total.pomodoros).toBe(1);
  });

  it("returns empty groups when project filter matches nothing", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    const result = getTodayGrouped({ store, now: NOW, project: "nonexistent" });
    expect(result.groups).toHaveLength(0);
    expect(result.total.pomodoros).toBe(0);
  });

  it("groups legacy entries without project under (unassigned)", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "completions.jsonl"),
      JSON.stringify({ completedAt: todayTs(), durationMs: 60_000 }) + "\n",
    );
    const result = getTodayGrouped({ store, now: NOW });
    const g = result.groups.find((g) => g.project === "(unassigned)");
    expect(g).toBeDefined();
    expect(g!.pomodoros).toBe(1);
  });

  it("excludes yesterday's entries", () => {
    store.appendCompletion({ completedAt: todayTs(), durationMs: 60_000, project: "proj-a" });
    store.appendCompletion({ completedAt: yestTs(), durationMs: 60_000, project: "proj-a" });
    const result = getTodayGrouped({ store, now: NOW });
    const g = result.groups.find((g) => g.project === "proj-a")!;
    expect(g.pomodoros).toBe(1);
  });
});

// ─── formatTodayGrouped ───────────────────────────────────────────────────────

describe("formatTodayGrouped", () => {
  it("shows grand total line when no groups", () => {
    const result: TodayGroupedResult = { groups: [], total: { pomodoros: 0, totalMs: 0 } };
    const out = formatTodayGrouped(result);
    expect(out).toContain("Total: 0 pomodoros");
  });

  it("includes project name line with pomodoro count and time", () => {
    const result: TodayGroupedResult = {
      groups: [
        {
          project: "pmdr",
          pomodoros: 2,
          totalMs: 3000_000,
          entries: [
            { completedAt: new Date("2024-01-15T09:00:00").getTime(), durationMs: 1500_000 },
            { completedAt: new Date("2024-01-15T09:30:00").getTime(), durationMs: 1500_000 },
          ],
        },
      ],
      total: { pomodoros: 2, totalMs: 3000_000 },
    };
    const out = formatTodayGrouped(result);
    expect(out).toContain("pmdr");
    expect(out).toContain("2 pomodoros");
  });

  it("includes grand total across all groups", () => {
    const result: TodayGroupedResult = {
      groups: [
        {
          project: "proj-a",
          pomodoros: 1,
          totalMs: 1500_000,
          entries: [{ completedAt: new Date("2024-01-15T09:00:00").getTime(), durationMs: 1500_000 }],
        },
        {
          project: "proj-b",
          pomodoros: 2,
          totalMs: 3000_000,
          entries: [
            { completedAt: new Date("2024-01-15T09:30:00").getTime(), durationMs: 1500_000 },
            { completedAt: new Date("2024-01-15T10:00:00").getTime(), durationMs: 1500_000 },
          ],
        },
      ],
      total: { pomodoros: 3, totalMs: 4500_000 },
    };
    const out = formatTodayGrouped(result);
    expect(out).toContain("Total: 3 pomodoros");
  });

  it("uses singular 'pomodoro' in total for count of 1", () => {
    const result: TodayGroupedResult = {
      groups: [
        {
          project: "pmdr",
          pomodoros: 1,
          totalMs: 1500_000,
          entries: [{ completedAt: new Date("2024-01-15T09:00:00").getTime(), durationMs: 1500_000 }],
        },
      ],
      total: { pomodoros: 1, totalMs: 1500_000 },
    };
    const out = formatTodayGrouped(result);
    expect(out).toContain("Total: 1 pomodoro,");
  });
});
