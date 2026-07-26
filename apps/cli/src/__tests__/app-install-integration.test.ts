import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAppInstall } from "../app-install.js";
import { createMenubarAppSystem } from "../menubar-app-system.js";
import { createAppProbes, installedAppPath } from "../app-probes.js";
import { bundledAppDir, createBundledAppModule } from "../bundled-app.js";

const zipPath = join(bundledAppDir(), "pmdr-app.zip");
const runnable = process.platform === "darwin" && existsSync(zipPath);

let home: string | null = null;

afterEach(() => {
  if (home !== null) rmSync(home, { recursive: true, force: true });
  home = null;
});

/**
 * Gated twice over: macOS only, and only when the app zip has been built
 * (`pnpm --filter @arielbk/pmdr build:app`) — it is a gitignored artifact.
 */
describe.skipIf(!runnable)("installing the real bundled app", () => {
  it("extracts a bundle whose code signature still verifies", () => {
    home = mkdtempSync(join(tmpdir(), "pmdr-install-home-"));
    const out: string[] = [];
    const err: string[] = [];

    const code = runAppInstall({
      platform: "darwin",
      home,
      noLaunch: true,
      bundled: createBundledAppModule(),
      // Real filesystem probes against the fake home; never touches the real one.
      probes: createAppProbes({ home, processRunning: () => false }),
      system: createMenubarAppSystem(home),
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });

    expect(err).toEqual([]);
    expect(code).toBe(0);

    const appPath = installedAppPath(home);
    expect(existsSync(appPath)).toBe(true);
    expect(out.join("\n")).toContain(appPath);

    // The point of the test: ditto + rename must not have broken the bundle.
    expect(() =>
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
        stdio: "ignore",
      }),
    ).not.toThrow();

    // Nothing left staged next to the installed bundle.
    expect(
      execFileSync("/bin/ls", ["-a", join(home, "Applications")], { encoding: "utf8" })
        .split("\n")
        .filter((entry) => entry.startsWith(".pmdr-install-")),
    ).toEqual([]);
  });

  it("reports the already-installed version on a second run", () => {
    home = mkdtempSync(join(tmpdir(), "pmdr-install-home-"));
    const install = () => {
      const out: string[] = [];
      const code = runAppInstall({
        platform: "darwin",
        home: home as string,
        noLaunch: true,
        bundled: createBundledAppModule(),
        probes: createAppProbes({ home: home as string, processRunning: () => false }),
        system: createMenubarAppSystem(home as string),
        stdout: (line) => out.push(line),
        stderr: () => {},
      });
      return { code, out };
    };

    expect(install().code).toBe(0);
    const second = install();

    expect(second.code).toBe(0);
    expect(second.out.join("\n")).toContain("already installed");
  });
});
