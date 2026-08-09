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

describe("buildLog with unbounded endpoints", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-log-unbounded-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("spans from the given date through today when --to is omitted", () => {
    store.appendCompletion({ completedAt: ts("2026-08-01"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-05"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-07", "11:00:00"), durationMs: 60_000, project: "a" });

    const result = buildLog({ store, now: NOW, from: "2026-08-04" });

    expect(result.from).toBe("2026-08-04");
    expect(result.to).toBe("2026-08-07");
    expect(result.days.map((d) => d.date)).toEqual(["2026-08-05", "2026-08-07"]);
  });

  it("spans the earliest record through the given date when --from is omitted", () => {
    store.appendCompletion({ completedAt: ts("2026-08-02"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-05"), durationMs: 60_000, project: "a" });
    store.appendCompletion({ completedAt: ts("2026-08-07", "11:00:00"), durationMs: 60_000, project: "a" });

    const result = buildLog({ store, now: NOW, to: "2026-08-05" });

    expect(result.from).toBe("2026-08-02");
    expect(result.to).toBe("2026-08-05");
    expect(result.days.map((d) => d.date)).toEqual(["2026-08-02", "2026-08-05"]);
  });

  it("spans the entire history when both endpoints are omitted", () => {
    store.appendCompletion({ completedAt: ts("2026-07-28"), durationMs: 60_000, project: "a" });
    store.appendNote(note({ at: ts("2026-07-20", "08:00:00"), text: "oldest" }));
    store.appendCompletion({ completedAt: ts("2026-08-07", "11:00:00"), durationMs: 60_000, project: "a" });

    const result = buildLog({ store, now: NOW });

    expect(result.from).toBe("2026-07-20");
    expect(result.to).toBe("2026-08-07");
    expect(result.days.map((d) => d.date)).toEqual(["2026-07-20", "2026-07-28", "2026-08-07"]);
    expect(result.total.pomodoros).toBe(2);
  });

  it("resolves both endpoints to today when there is no history at all", () => {
    const result = buildLog({ store, now: NOW });

    expect(result.from).toBe("2026-08-07");
    expect(result.to).toBe("2026-08-07");
    expect(result.days).toEqual([]);
  });
});
