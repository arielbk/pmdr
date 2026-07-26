import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTuiPrecondition } from "../tui-precondition.js";

describe("checkTuiPrecondition", () => {
  it("allows the TUI when both streams are a TTY", () => {
    expect(
      checkTuiPrecondition({ stdinIsTty: true, stdoutIsTty: true }),
    ).toEqual({ ok: true });
  });

  it("refuses when stdin is not a TTY, naming the JSON alternative", () => {
    const decision = checkTuiPrecondition({
      stdinIsTty: false,
      stdoutIsTty: true,
    });

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.message).toContain("needs an interactive terminal");
    expect(decision.message).toContain("pmdr status --json");
  });

  it("refuses when stdout is not a TTY (piped into another process)", () => {
    const decision = checkTuiPrecondition({
      stdinIsTty: true,
      stdoutIsTty: false,
    });

    expect(decision.ok).toBe(false);
  });

  it("keeps the refusal to a single line so scripts stay readable", () => {
    const decision = checkTuiPrecondition({
      stdinIsTty: false,
      stdoutIsTty: false,
    });

    if (decision.ok) throw new Error("expected a refusal");
    expect(decision.message.split("\n")).toHaveLength(1);
  });
});

// ─── CLI integration ─────────────────────────────────────────────────────────

describe("plain `pmdr` with a non-interactive stdin", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(testDir, "../../../..");
  const cliDist = join(repoRoot, "apps/cli/dist/index.js");
  let tmpDir: string;

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
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-cli-tui-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runPlainPmdr() {
    const binDir = join(tmpDir, "bin");
    const homeDir = join(tmpDir, "home");
    mkdirSync(binDir);
    mkdirSync(homeDir);
    symlinkSync(cliDist, join(binDir, "pmdr"));

    return spawnSync("pmdr", [], {
      env: {
        HOME: homeDir,
        PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      },
      input: "",
      encoding: "utf8",
      timeout: 15_000,
    });
  }

  it("exits 1 with a one-line explanation instead of rendering", () => {
    const result = runPlainPmdr();

    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("needs an interactive terminal");
    expect(result.stderr).toContain("pmdr status --json");
  });

  /**
   * The bug this guards: Ink's `render` threw "Raw mode is not supported" and
   * the unhandled failure printed ~40 lines of Ink and react-reconciler frames
   * — renderer internals leaking to anyone scripting the CLI.
   */
  it("never leaks renderer internals to a scripted caller", () => {
    const result = runPlainPmdr();
    const output = `${result.stdout}${result.stderr}`;

    expect(output).not.toContain("react-reconciler");
    expect(output).not.toContain("Raw mode is not supported");
    expect(output).not.toContain("node_modules/ink");
  });
});
