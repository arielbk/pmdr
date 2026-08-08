import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, type NoteRecord } from "../state.js";
import { buildLog } from "../commands/log.js";
import { buildToday } from "../commands/today.js";

const NOW = new Date("2026-08-07T12:00:00").getTime();

function ts(date: string, time = "09:00:00"): number {
  return new Date(`${date}T${time}`).getTime();
}

function note(partial: Partial<NoteRecord> & { at: number; text: string }): NoteRecord {
  return { sessionId: "", project: "", phase: "", ...partial };
}

describe("buildToday as an alias for a single-day log range", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-today-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seed(): void {
    store.appendCompletion({ completedAt: ts("2026-08-06"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-07"), durationMs: 1500_000, project: "a" });
    store.appendCompletion({
      completedAt: ts("2026-08-07", "10:30:00"),
      durationMs: 1500_000,
      project: "b",
    });
    store.appendNote(note({ at: ts("2026-08-07", "11:00:00"), text: "a note" }));
    store.appendNote(note({ at: ts("2026-08-06", "11:00:00"), text: "yesterday's note" }));
  }

  it("produces the same payload as an explicit range naming today's date", () => {
    seed();

    expect(buildToday({ store, now: NOW })).toEqual(
      buildLog({ store, now: NOW, from: "2026-08-07", to: "2026-08-07" }),
    );
  });

  it("forwards --project to the range query", () => {
    seed();

    const result = buildToday({ store, now: NOW, project: "b" });

    expect(result).toEqual(
      buildLog({ store, now: NOW, from: "2026-08-07", to: "2026-08-07", project: "b" }),
    );
    expect(result.days[0]!.groups.map((g) => g.project)).toEqual(["b"]);
  });

  it("settles an expired focus before reading, so its completion is counted today", () => {
    // focus expired 10s ago → break is born paused; one focus completion is logged
    store.writeState({
      startedAt: NOW - 70_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    });

    const result = buildToday({ store, now: NOW });

    expect(result.total.pomodoros).toBe(1);
    expect(store.readState()?.phase).toBe("break");
  });

  it("reports an empty day as an empty range over today's date", () => {
    const result = buildToday({ store, now: NOW });

    expect(result.from).toBe("2026-08-07");
    expect(result.to).toBe("2026-08-07");
    expect(result.days).toEqual([]);
    expect(result.total).toEqual({ pomodoros: 0, totalMs: 0 });
  });

  it("keeps today's notes, in ascending time order, on a day with no completions", () => {
    store.appendNote(note({ at: ts("2026-08-07", "14:00:00"), text: "later" }));
    store.appendNote(note({ at: ts("2026-08-07", "09:30:00"), text: "earlier" }));
    store.appendNote(note({ at: ts("2026-08-06", "09:30:00"), text: "yesterday" }));

    const result = buildToday({ store, now: NOW });

    expect(result.days.map((d) => d.date)).toEqual(["2026-08-07"]);
    expect(result.days[0]!.notes.map((n) => n.text)).toEqual(["earlier", "later"]);
  });
});
