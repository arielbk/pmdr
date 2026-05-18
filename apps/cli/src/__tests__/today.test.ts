import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import { getToday, filterToday, formatToday } from "../commands/today.js";
import type { TodayResult } from "../commands/today.js";

// ─── filterToday ──────────────────────────────────────────────────────────────

describe("filterToday", () => {
  // Use a fixed "now" anchored to a stable local date
  // 2024-01-15 12:00:00 local time — we'll use Date.UTC but also account for
  // that the local timezone in CI may differ. Use a midday UTC time so most TZs
  // agree on the date.
  const NOW_DATE = new Date("2024-01-15T12:00:00.000Z").getTime();

  function makeTs(isoDate: string): number {
    // Create a timestamp that falls on that local-calendar date at noon
    // by using the Date constructor with the date string (parsed as local).
    return new Date(`${isoDate}T12:00:00`).getTime();
  }

  it("returns empty array for empty input", () => {
    expect(filterToday([], NOW_DATE)).toEqual([]);
  });

  it("includes completions that fall on the same local date as now", () => {
    const nowD = new Date(NOW_DATE);
    const y = nowD.getFullYear();
    const m = String(nowD.getMonth() + 1).padStart(2, "0");
    const d = String(nowD.getDate()).padStart(2, "0");
    const todayTs = makeTs(`${y}-${m}-${d}`);
    const completions = [{ completedAt: todayTs, durationMs: 1500_000 }];
    expect(filterToday(completions, NOW_DATE)).toHaveLength(1);
  });

  it("excludes completions from a previous local date", () => {
    const nowD = new Date(NOW_DATE);
    // Build yesterday's local date string
    const yesterday = new Date(nowD);
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, "0");
    const d = String(yesterday.getDate()).padStart(2, "0");
    const yestTs = makeTs(`${y}-${m}-${d}`);
    expect(filterToday([{ completedAt: yestTs, durationMs: 1500_000 }], NOW_DATE)).toHaveLength(0);
  });

  it("excludes completions from a future local date", () => {
    const nowD = new Date(NOW_DATE);
    const tomorrow = new Date(nowD);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const d = String(tomorrow.getDate()).padStart(2, "0");
    const tomTs = makeTs(`${y}-${m}-${d}`);
    expect(filterToday([{ completedAt: tomTs, durationMs: 1500_000 }], NOW_DATE)).toHaveLength(0);
  });

  it("correctly splits a mixed list across the boundary", () => {
    const nowD = new Date(NOW_DATE);
    const today = new Date(NOW_DATE);
    const yesterday = new Date(nowD);
    yesterday.setDate(yesterday.getDate() - 1);

    function tsForDate(d: Date): number {
      return new Date(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T12:00:00`,
      ).getTime();
    }

    const completions = [
      { completedAt: tsForDate(yesterday), durationMs: 1500_000 },
      { completedAt: tsForDate(today), durationMs: 1500_000 },
      { completedAt: tsForDate(today), durationMs: 600_000 },
    ];
    const result = filterToday(completions, NOW_DATE);
    expect(result).toHaveLength(2);
  });
});

// ─── formatToday ──────────────────────────────────────────────────────────────

describe("formatToday", () => {
  it("formats zero completions", () => {
    const r: TodayResult = { count: 0, completions: [] };
    expect(formatToday(r)).toBe("0 pomodoros today");
  });

  it("uses singular 'pomodoro' for count of 1", () => {
    const r: TodayResult = {
      count: 1,
      completions: [{ completedAt: new Date("2024-01-15T09:30:00").getTime(), durationMs: 1500_000 }],
    };
    const out = formatToday(r);
    expect(out).toContain("1 pomodoro today");
  });

  it("uses plural 'pomodoros' for count > 1", () => {
    const r: TodayResult = {
      count: 2,
      completions: [
        { completedAt: new Date("2024-01-15T09:30:00").getTime(), durationMs: 1500_000 },
        { completedAt: new Date("2024-01-15T10:00:00").getTime(), durationMs: 1500_000 },
      ],
    };
    const out = formatToday(r);
    expect(out).toContain("2 pomodoros today");
  });

  it("lists each completion timestamp on its own line with 2-space indent", () => {
    const ts1 = new Date("2024-01-15T09:30:00").getTime();
    const ts2 = new Date("2024-01-15T11:05:00").getTime();
    const r: TodayResult = {
      count: 2,
      completions: [
        { completedAt: ts1, durationMs: 1500_000 },
        { completedAt: ts2, durationMs: 1500_000 },
      ],
    };
    const lines = formatToday(r).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^\s{2}/);
    expect(lines[2]).toMatch(/^\s{2}/);
  });

  it("pads minutes with leading zero", () => {
    const ts = new Date("2024-01-15T09:05:00").getTime();
    const r: TodayResult = {
      count: 1,
      completions: [{ completedAt: ts, durationMs: 1500_000 }],
    };
    const out = formatToday(r);
    // Should contain "9:05" (local time)
    expect(out).toContain(":05");
  });
});

// ─── getToday ─────────────────────────────────────────────────────────────────

describe("getToday", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = new Date("2024-01-15T12:00:00").getTime();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result when no completions file exists", () => {
    expect(getToday({ store, now: NOW })).toEqual({ count: 0, completions: [] });
  });

  it("returns all completions from today", () => {
    const todayTs = new Date("2024-01-15T09:00:00").getTime();
    store.appendCompletion({ completedAt: todayTs, durationMs: 1500_000, project: "(unassigned)" });
    store.appendCompletion({ completedAt: todayTs + 60_000, durationMs: 1500_000, project: "(unassigned)" });
    const result = getToday({ store, now: NOW });
    expect(result.count).toBe(2);
    expect(result.completions).toHaveLength(2);
  });

  it("excludes yesterday's completions", () => {
    const yestTs = new Date("2024-01-14T23:00:00").getTime();
    const todayTs = new Date("2024-01-15T09:00:00").getTime();
    store.appendCompletion({ completedAt: yestTs, durationMs: 1500_000, project: "(unassigned)" });
    store.appendCompletion({ completedAt: todayTs, durationMs: 1500_000, project: "(unassigned)" });
    const result = getToday({ store, now: NOW });
    expect(result.count).toBe(1);
  });

  it("advances an expired focus to break and includes the focus completion in today's count", () => {
    // focus expired 10s ago → break auto-starts; one focus completion is logged
    const startedAt = NOW - 70_000;
    store.writeState({
      startedAt,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });
    const result = getToday({ store, now: NOW });
    expect(result.count).toBe(1);
    // State is now a running break (not null)
    expect(store.readState()?.phase).toBe("break");
  });

  it("json shape has count and completions array with completedAt and durationMs", () => {
    const todayTs = new Date("2024-01-15T09:00:00").getTime();
    store.appendCompletion({ completedAt: todayTs, durationMs: 1500_000, project: "(unassigned)" });
    const result = getToday({ store, now: NOW });
    expect(result).toMatchObject({
      count: 1,
      completions: [{ completedAt: todayTs, durationMs: 1500_000 }],
    });
  });
});
