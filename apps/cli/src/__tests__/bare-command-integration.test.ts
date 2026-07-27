import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideCountdown, SCRIPTED_TIMER_NOTE } from "../commands/start.js";

describe("decideCountdown", () => {
  it("renders the live countdown on a terminal", () => {
    expect(decideCountdown({ detach: false, stdoutIsTty: true })).toEqual({
      render: true,
    });
  });

  it("stays silent when --detach asked for it", () => {
    expect(decideCountdown({ detach: true, stdoutIsTty: true })).toEqual({
      render: false,
      note: null,
    });
  });

  it("starts detached with one pointer line when stdout is not a terminal", () => {
    const mode = decideCountdown({ detach: false, stdoutIsTty: false });

    expect(mode).toEqual({ render: false, note: SCRIPTED_TIMER_NOTE });
    if (mode.render) return;
    expect(mode.note?.split("\n")).toHaveLength(1);
    expect(mode.note).toContain("pmdr status --json");
  });

  it("prefers the explicit --detach silence over the pointer line", () => {
    expect(decideCountdown({ detach: true, stdoutIsTty: false })).toEqual({
      render: false,
      note: null,
    });
  });
});

// ─── CLI integration ─────────────────────────────────────────────────────────

/**
 * Bare `pmdr` in a script is this feature's worst failure mode: it used to be a
 * refusal, and before that a 40-line Ink stack trace. Now it starts the timer —
 * so what has to be true is that it *returns*, having said what it did, instead
 * of holding the pipe open for the whole pomodoro.
 */
describe("plain `pmdr` with non-interactive streams", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(testDir, "../../../..");
  const cliDist = join(repoRoot, "apps/cli/dist/index.js");
  let tmpDir: string;
  let homeDir: string;
  let binDir: string;

  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@arielbk/pmdr", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    if (!existsSync(cliDist)) {
      throw new Error(`build produced no CLI entrypoint at ${cliDist}`);
    }
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-cli-bare-"));
    binDir = join(tmpDir, "bin");
    homeDir = join(tmpDir, "home");
    mkdirSync(binDir);
    mkdirSync(homeDir);
    symlinkSync(cliDist, join(binDir, "pmdr"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runPmdr(args: string[] = []) {
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

  it("starts a pomodoro and exits instead of holding the pipe open", () => {
    const result = runPmdr();

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toContain("Starting 25m pomodoro...");
    expect(result.stdout).toContain("pmdr status --json");
    expect(result.stderr).toBe("");
  });

  it("skips onboarding without a TTY, because prompts would hang the caller", () => {
    const result = runPmdr();

    expect(result.stdout).not.toContain("Setting up pmdr");
    expect(result.stdout).not.toContain("Which project");
  });

  it("attaches to the running session rather than failing to start on top of it", () => {
    expect(runPmdr().status).toBe(0);

    const second = runPmdr();

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Attached to the current focus session.");
    expect(second.stderr).not.toContain("already running");
  });

  /**
   * The bug this still guards: Ink's `render` threw "Raw mode is not supported"
   * and the unhandled failure printed ~40 lines of Ink and react-reconciler
   * frames at anyone scripting the CLI.
   */
  it("never leaks renderer internals to a scripted caller", () => {
    const result = runPmdr();
    const output = `${result.stdout}${result.stderr}`;

    expect(output).not.toContain("react-reconciler");
    expect(output).not.toContain("Raw mode is not supported");
    expect(output).not.toContain("node_modules/ink");
  });

  /**
   * Guards the bundle's `package.json` resolution: every module ends up in
   * `dist/index.js`, so a path that works from `src/commands/` throws
   * `MODULE_NOT_FOUND` at the person running the published CLI. `--version` and
   * `pmdr setup` read it through the same helper.
   */
  it("reads its own version off the built bundle", () => {
    const result = runPmdr(["--version"]);

    expect(result.stdout + result.stderr).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stderr).not.toContain("Cannot find module");
  });

  it("refuses `pmdr setup` without a terminal, naming the commands to use instead", () => {
    const result = runPmdr(["setup"]);

    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("interactive terminal");
    expect(result.stderr).toContain("pmdr app install");
  });
});
