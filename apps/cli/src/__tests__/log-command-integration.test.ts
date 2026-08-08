import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureCliBuilt } from "./helpers/built-cli.js";

describe("pmdr log", () => {
  let cliDist: string;
  let tmpDir: string;
  let homeDir: string;
  let binDir: string;
  let stateDir: string;

  beforeAll(() => {
    cliDist = ensureCliBuilt();
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-cli-log-"));
    binDir = join(tmpDir, "bin");
    homeDir = join(tmpDir, "home");
    stateDir = join(homeDir, ".local", "state", "pmdr");
    mkdirSync(binDir);
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(cliDist, join(binDir, "pmdr"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runPmdr(args: string[]) {
    return spawnSync("pmdr", args, {
      env: {
        HOME: homeDir,
        PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      },
      input: "",
      encoding: "utf8",
      timeout: 15_000,
    });
  }

  it("prints the day-grouped JSON payload for an explicit range", () => {
    writeFileSync(
      join(stateDir, "completions.jsonl"),
      [
        JSON.stringify({
          completedAt: new Date("2026-08-04T09:00:00").getTime(),
          durationMs: 1500_000,
          project: "pmdr",
        }),
        JSON.stringify({
          completedAt: new Date("2026-08-09T09:00:00").getTime(),
          durationMs: 1500_000,
          project: "pmdr",
        }),
      ].join("\n") + "\n",
    );

    const result = runPmdr(["log", "--from", "2026-08-03", "--to", "2026-08-07", "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      from: "2026-08-03",
      to: "2026-08-07",
      days: [
        {
          date: "2026-08-04",
          groups: [{ project: "pmdr", pomodoros: 1, totalMs: 1500_000 }],
          total: { pomodoros: 1, totalMs: 1500_000 },
          notes: [],
        },
      ],
      total: { pomodoros: 1, totalMs: 1500_000 },
    });
  });

  it("filters the whole range to one project", () => {
    writeFileSync(
      join(stateDir, "completions.jsonl"),
      [
        JSON.stringify({
          completedAt: new Date("2026-08-04T09:00:00").getTime(),
          durationMs: 60_000,
          project: "a",
        }),
        JSON.stringify({
          completedAt: new Date("2026-08-05T09:00:00").getTime(),
          durationMs: 60_000,
          project: "b",
        }),
      ].join("\n") + "\n",
    );

    const result = runPmdr([
      "log",
      "--from",
      "2026-08-03",
      "--to",
      "2026-08-07",
      "--project",
      "b",
      "--json",
    ]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.days.map((d: { date: string }) => d.date)).toEqual(["2026-08-05"]);
    expect(payload.total.pomodoros).toBe(1);
  });
});
