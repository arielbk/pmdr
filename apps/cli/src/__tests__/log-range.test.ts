import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, type NoteRecord } from "../state.js";
import { buildLog } from "../commands/log.js";

const NOW = new Date("2026-08-07T12:00:00").getTime();

function ts(date: string, time = "09:00:00"): number {
  return new Date(`${date}T${time}`).getTime();
}

function note(partial: Partial<NoteRecord> & { at: number; text: string }): NoteRecord {
  return { sessionId: "", project: "", phase: "", ...partial };
}

describe("buildLog over an explicit range", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-log-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("groups completions by local date and then by project", () => {
    store.appendCompletion({ completedAt: ts("2026-08-04"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-04", "10:00:00"), durationMs: 60_000, project: "b" });
    store.appendCompletion({ completedAt: ts("2026-08-06"), durationMs: 60_000, project: "a" });

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07" });

    expect(result.from).toBe("2026-08-03");
    expect(result.to).toBe("2026-08-07");
    expect(result.days.map((d) => d.date)).toEqual(["2026-08-04", "2026-08-06"]);
    expect(result.days[0]!.groups.map((g) => g.project)).toEqual(["a", "b"]);
    expect(result.days[1]!.groups).toHaveLength(1);
  });

  it("keeps a day that has only notes, in ascending time order", () => {
    store.appendNote(note({ at: ts("2026-08-05", "14:00:00"), text: "later" }));
    store.appendNote(note({ at: ts("2026-08-05", "09:30:00"), text: "earlier" }));

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07" });

    expect(result.days.map((d) => d.date)).toEqual(["2026-08-05"]);
    const day = result.days[0]!;
    expect(day.groups).toHaveLength(0);
    expect(day.total).toEqual({ pomodoros: 0, totalMs: 0 });
    expect(day.notes.map((n) => n.text)).toEqual(["earlier", "later"]);
  });

  it("omits days with neither completions nor notes", () => {
    store.appendCompletion({ completedAt: ts("2026-08-04"), durationMs: 60_000, project: "a" });
    store.appendNote(note({ at: ts("2026-08-06"), text: "n" }));

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07" });

    expect(result.days.map((d) => d.date)).toEqual(["2026-08-04", "2026-08-06"]);
  });

  it("includes both edges of the range", () => {
    store.appendCompletion({ completedAt: ts("2026-08-03", "00:00:00"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-07", "23:59:59"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-02", "23:59:59"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-08", "00:00:00"), durationMs: 60_000, project: "a" });

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07" });

    expect(result.days.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-07"]);
  });

  it("agrees on per-day and range-level totals", () => {
    store.appendCompletion({ completedAt: ts("2026-08-04"), durationMs: 1500_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-04", "10:00:00"), durationMs: 600_000, project: "b" });
    store.appendCompletion({ completedAt: ts("2026-08-06"), durationMs: 900_000, project: "a" });

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07" });

    expect(result.days[0]!.total).toEqual({ pomodoros: 2, totalMs: 2100_000 });
    expect(result.days[1]!.total).toEqual({ pomodoros: 1, totalMs: 900_000 });
    expect(result.total).toEqual({ pomodoros: 3, totalMs: 3000_000 });
  });

  it("applies the project filter across every day", () => {
    store.appendCompletion({ completedAt: ts("2026-08-04"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-04", "10:00:00"), durationMs: 60_000, project: "b" });
    store.appendCompletion({ completedAt: ts("2026-08-06"), durationMs: 60_000, project: "b" });

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07", project: "b" });

    expect(result.days.map((d) => d.date)).toEqual(["2026-08-04", "2026-08-06"]);
    expect(result.days.every((d) => d.groups.every((g) => g.project === "b"))).toBe(true);
    expect(result.total.pomodoros).toBe(2);
  });

  it("settles an expired timer before reading, so its completion is reported", () => {
    const startedAt = ts("2026-08-07", "11:00:00");
    store.writeState({
      startedAt,
      durationMs: 1500_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "a",
      phase: "focus",
    });

    const result = buildLog({ store, now: NOW, from: "2026-08-03", to: "2026-08-07" });

    const day = result.days.find((d) => d.date === "2026-08-07")!;
    expect(day.total).toEqual({ pomodoros: 1, totalMs: 1500_000 });
  });
});
