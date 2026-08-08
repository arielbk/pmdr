import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule, type NoteRecord } from "../state.js";
import { buildLog, formatLog } from "../commands/log.js";

const NOW = new Date("2026-08-07T12:00:00").getTime();

function ts(date: string, time = "09:00:00"): number {
  return new Date(`${date}T${time}`).getTime();
}

function note(partial: Partial<NoteRecord> & { at: number; text: string }): NoteRecord {
  return { sessionId: "", project: "", phase: "", ...partial };
}

describe("formatLog", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-log-format-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints the date header for a single-day range and omits the grand total", () => {
    store.appendCompletion({ completedAt: ts("2026-08-05", "09:00:00"), durationMs: 1_500_000, project: "alpha" });

    const output = formatLog(buildLog({ store, now: NOW, from: "2026-08-05", to: "2026-08-05" }));

    expect(output).toBe(
      ["2026-08-05", "  alpha: 1 pomodoro, 25m", "    9:00"].join("\n"),
    );
  });

  it("renders each day as its own block with a grand total across a multi-day range", () => {
    store.appendCompletion({ completedAt: ts("2026-08-05", "09:00:00"), durationMs: 1_500_000, project: "alpha" });
    store.appendCompletion({ completedAt: ts("2026-08-05", "10:05:00"), durationMs: 1_500_000, project: "alpha" });
    store.appendCompletion({ completedAt: ts("2026-08-06", "14:30:00"), durationMs: 1_500_000, project: "beta" });
    store.appendNote(note({ at: ts("2026-08-06", "15:00:00"), text: "got interrupted" }));

    const output = formatLog(buildLog({ store, now: NOW, from: "2026-08-05", to: "2026-08-06" }));

    expect(output).toBe(
      [
        "2026-08-05",
        "  alpha: 2 pomodoros, 50m",
        "    9:00",
        "    10:05",
        "",
        "2026-08-06",
        "  beta: 1 pomodoro, 25m",
        "    14:30",
        "  Notes:",
        "    15:00  got interrupted",
        "",
        "Total: 3 pomodoros, 75m",
      ].join("\n"),
    );
  });

  it("renders a notes-only day under its date header", () => {
    store.appendNote(note({ at: ts("2026-08-05", "11:20:00"), text: "no pomodoro, just a thought" }));

    const output = formatLog(buildLog({ store, now: NOW, from: "2026-08-05", to: "2026-08-05" }));

    expect(output).toBe(
      ["2026-08-05", "  Notes:", "    11:20  no pomodoro, just a thought"].join("\n"),
    );
  });

  it("says so explicitly when the range holds nothing", () => {
    const output = formatLog(buildLog({ store, now: NOW, from: "2026-08-01", to: "2026-08-02" }));

    expect(output).toBe("Nothing recorded from 2026-08-01 to 2026-08-02");
  });
});
