import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  APP_BUNDLE_ID,
  APP_BUNDLE_NAME,
  appProcessPattern,
  installedAppPath,
  loginItemPlistPath,
} from "./app-probes.js";
import { compareVersions } from "./app-status.js";
import type { InstalledApp } from "./app-status.js";
import type { BundledApp } from "./bundled-app.js";

export const NON_MACOS_MESSAGE =
  "pmdr app: the menubar app is macOS only — nothing to install on this platform";
export const NON_MACOS_UNINSTALL_MESSAGE =
  "pmdr app: the menubar app is macOS only — nothing to uninstall on this platform";

/** Every side effect installing the app needs, injected so orchestration is testable. */
export interface InstallSystem {
  exists(path: string): boolean;
  mkdtemp(): string;
  mkdirp(dir: string): void;
  remove(path: string): void;
  move(from: string, to: string): void;
  extract(zipPath: string, destDir: string): void;
  quitApp(): void;
  launchApp(appPath: string): void;
}

/**
 * The real macOS side effects. Staging happens *inside* `~/Applications` rather
 * than `/tmp` so the swap is a same-volume `rename` — copying across volumes is
 * what breaks a bundle's symlinks, xattrs and therefore its code signature.
 */
export function createInstallSystem(home: string = homedir()): InstallSystem {
  const applications = dirname(installedAppPath(home));

  return {
    exists: (path) => existsSync(path),
    mkdtemp() {
      mkdirSync(applications, { recursive: true });
      return mkdtempSync(join(applications, ".pmdr-install-"));
    },
    mkdirp: (dir) => {
      mkdirSync(dir, { recursive: true });
    },
    remove: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
    move: (from, to) => {
      renameSync(from, to);
    },
    extract: (zipPath, destDir) => {
      execFileSync("/usr/bin/ditto", ["-x", "-k", zipPath, destDir], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    },
    quitApp() {
      try {
        execFileSync(
          "/usr/bin/osascript",
          ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`],
          { stdio: "ignore" },
        );
      } catch {
        // Not every build answers AppleScript; a signal is the honest fallback.
        try {
          execFileSync("/usr/bin/pkill", ["-f", appProcessPattern(installedAppPath(home))], {
            stdio: "ignore",
          });
        } catch {
          // pkill exits non-zero when nothing matched — already gone, fine.
        }
      }
    },
    launchApp: (appPath) => {
      execFileSync("/usr/bin/open", ["-a", appPath], { stdio: "ignore" });
    },
  };
}

export interface AppInstallRunDeps {
  platform: string;
  home: string;
  force?: boolean;
  noLaunch?: boolean;
  bundled: { locate(): BundledApp };
  probes: { probeInstalled(): InstalledApp; probeRunning(): boolean };
  system: InstallSystem;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppInstall(deps: AppInstallRunDeps): number {
  if (deps.platform !== "darwin") {
    deps.stderr(NON_MACOS_MESSAGE);
    return 1;
  }

  const bundled = deps.bundled.locate();
  if (!bundled.present) {
    deps.stderr(`pmdr app install: ${bundled.reason}`);
    return 1;
  }

  const installed = deps.probes.probeInstalled();
  const appPath = installedAppPath(deps.home);

  if (
    installed.present &&
    deps.force !== true &&
    compareVersions(installed.version, bundled.version) === 0
  ) {
    deps.stdout(`App: ${installed.version} already installed at ${appPath}`);
    return 0;
  }

  const staging = deps.system.mkdtemp();
  try {
    deps.system.extract(bundled.zipPath, staging);
    const staged = join(staging, APP_BUNDLE_NAME);
    if (!deps.system.exists(staged)) {
      throw new Error(`extracted archive contained no ${APP_BUNDLE_NAME}`);
    }

    // Quit only once we have a good replacement staged, so a failed extract
    // never leaves the user with a killed app and nothing to launch.
    if (deps.probes.probeRunning()) deps.system.quitApp();

    deps.system.mkdirp(dirname(appPath));
    if (deps.system.exists(appPath)) deps.system.remove(appPath);
    deps.system.move(staged, appPath);
  } catch (error) {
    deps.stderr(`pmdr app install: ${messageOf(error)}`);
    tryRemove(deps.system, staging);
    return 1;
  }
  tryRemove(deps.system, staging);

  deps.stdout(`App: ${bundled.version} installed at ${appPath}`);

  if (deps.noLaunch !== true) {
    try {
      deps.system.launchApp(appPath);
    } catch (error) {
      // The bundle is in place; only the launch failed. Say exactly that, and
      // still exit non-zero so scripts don't assume a running menubar app.
      deps.stderr(
        `pmdr app install: installed but could not be launched — ${messageOf(error)}`,
      );
      return 1;
    }
  }
  return 0;
}

/**
 * citty parses `--no-launch` as a negation of a `launch` flag, not as an arg
 * literally named `no-launch` — so the flag has to be declared as `launch` and
 * read back that way, or `--no-launch` silently does nothing.
 */
export function installOptionsFromArgs(args: {
  force?: boolean;
  launch?: boolean;
}): { force: boolean; noLaunch: boolean } {
  return { force: args.force === true, noLaunch: args.launch === false };
}

export interface AppUninstallRunDeps {
  platform: string;
  home: string;
  probes: { probeRunning(): boolean };
  system: InstallSystem;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppUninstall(deps: AppUninstallRunDeps): number {
  if (deps.platform !== "darwin") {
    deps.stderr(NON_MACOS_UNINSTALL_MESSAGE);
    return 1;
  }

  const appPath = installedAppPath(deps.home);
  const plistPath = loginItemPlistPath(deps.home);
  const removed: string[] = [];

  try {
    if (deps.probes.probeRunning()) deps.system.quitApp();
    if (deps.system.exists(appPath)) {
      deps.system.remove(appPath);
      removed.push(appPath);
    }
    // The login item points at the bundle we just removed, so it goes too —
    // otherwise login would keep trying to launch an app that isn't there.
    if (deps.system.exists(plistPath)) {
      deps.system.remove(plistPath);
      removed.push(plistPath);
    }
  } catch (error) {
    deps.stderr(`pmdr app uninstall: ${messageOf(error)}`);
    return 1;
  }

  deps.stdout(
    removed.length === 0
      ? "App: not installed, nothing to remove"
      : `App: removed ${removed.join(" and ")}`,
  );
  return 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Staging cleanup must never mask the real outcome of the install. */
function tryRemove(system: InstallSystem, path: string): void {
  try {
    system.remove(path);
  } catch {
    // best effort — a leftover temp dir is not worth failing the install over
  }
}
