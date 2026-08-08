import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureCliBuilt } from "./helpers/built-cli.js";

function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("pmdr today", () => {
  let cliDist: string;
  let tmpDir: string;
  let homeDir: string;
  let binDir: string;
  let stateDir: string;

  beforeAll(() => {
    cliDist = ensureCliBuilt();
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-cli-today-"));
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

  function seedTodayAndYesterday(): { today: Date } {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86_400_000);
    writeFileSync(
      join(stateDir, "completions.jsonl"),
      [
        JSON.stringify({ completedAt: yesterday.getTime(), durationMs: 60_000, project: "old" }),
        JSON.stringify({ completedAt: today.getTime(), durationMs: 1500_000, project: "pmdr" }),
      ].join("\n") + "\n",
    );
    return { today };
  }

  it("prints the same JSON payload as an explicit single-day log range", () => {
    const { today } = seedTodayAndYesterday();
    const date = localDateKey(today.getTime());

    const aliased = runPmdr(["today", "--json"]);
    const explicit = runPmdr(["log", "--from", date, "--to", date, "--json"]);

    expect(aliased.status).toBe(0);
    expect(JSON.parse(aliased.stdout)).toEqual(JSON.parse(explicit.stdout));
    expect(JSON.parse(aliased.stdout)).toMatchObject({
      from: date,
      to: date,
      days: [{ date, groups: [{ project: "pmdr", pomodoros: 1, totalMs: 1500_000 }] }],
    });
  });

  it("renders a single day block with no grand total without --json", () => {
    const { today } = seedTodayAndYesterday();

    const result = runPmdr(["today"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      localDateKey(today.getTime()),
      "  pmdr: 1 pomodoro, 25m",
      "    9:00",
    ]);
  });
});
