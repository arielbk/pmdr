import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAppProbes, installedAppPath } from "../app-probes.js";
import { bundledAppDir } from "../bundled-app.js";
import { createMenubarApp } from "../menubar-app.js";

const zipPath = join(bundledAppDir(), "pmdr-app.zip");
const runnable = process.platform === "darwin" && existsSync(zipPath);

let home: string | null = null;

afterEach(() => {
  if (home !== null) rmSync(home, { recursive: true, force: true });
  home = null;
});

/** Real filesystem probes against the fake home; never touches the real one. */
function appIn(fakeHome: string) {
  return createMenubarApp({
    home: fakeHome,
    probes: createAppProbes({ home: fakeHome, processRunning: () => false }),
  });
}

/**
 * Gated twice over: macOS only, and only when the app zip has been built
 * (`pnpm --filter @arielbk/pmdr build:app`) — it is a gitignored artifact.
 */
describe.skipIf(!runnable)("installing the real bundled app", () => {
  it("extracts a bundle whose code signature still verifies", () => {
    home = mkdtempSync(join(tmpdir(), "pmdr-install-home-"));

    expect(appIn(home).install({ launch: false }).kind).toBe("installed");

    const appPath = installedAppPath(home);
    expect(existsSync(appPath)).toBe(true);

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
    const app = appIn(home);

    expect(app.install({ launch: false }).kind).toBe("installed");
    expect(app.install({ launch: false }).kind).toBe("already-current");
  });
});
