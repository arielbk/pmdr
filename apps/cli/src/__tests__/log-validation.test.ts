import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureCliBuilt } from "./helpers/built-cli.js";
import { resolveRange } from "../date-range.js";

describe("pmdr log with an invalid range", () => {
  let cliDist: string;
  let tmpDir: string;
  let homeDir: string;
  let binDir: string;

  beforeAll(() => {
    cliDist = ensureCliBuilt();
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-cli-log-invalid-"));
    binDir = join(tmpDir, "bin");
    homeDir = join(tmpDir, "home");
    mkdirSync(binDir);
    mkdirSync(join(homeDir, ".local", "state", "pmdr"), { recursive: true });
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

  it("rejects a malformed date without writing to stdout", () => {
    const result = runPmdr(["log", "--from", "not-a-date", "--json"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not-a-date");
    expect(result.stderr).toContain("YYYY-MM-DD");
    // An agent reads stderr to tell a bad invocation from an empty result — a
    // stack trace is noise, not an explanation.
    expect(result.stderr).not.toContain("    at ");
  });

  it("rejects a from later than to without writing to stdout", () => {
    const result = runPmdr(["log", "--from", "2026-08-07", "--to", "2026-08-03", "--json"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("2026-08-07");
    expect(result.stderr).toContain("2026-08-03");
    expect(result.stderr).not.toContain("    at ");
  });
});

describe("resolveRange", () => {
  const now = new Date("2026-08-08T12:00:00").getTime();

  it("rejects a --to that falls before the resolved unbounded start", () => {
    const earliest = new Date("2026-08-01T09:00:00").getTime();

    expect(() => resolveRange({ to: "2026-07-01", now, earliest })).toThrow(
      /2026-08-01[\s\S]*2026-07-01/,
    );
  });

  it("accepts a single-day range where from and to are equal", () => {
    const window = resolveRange({ from: "2026-08-08", to: "2026-08-08", now });

    expect(window.startMs).toBeLessThan(window.endMs);
    expect(window.from).toBe("2026-08-08");
  });
});
