import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { InstalledApp } from "./app-status.js";

/** Identity of the menubar app, shared by install, status and login-item code. */
export const APP_BUNDLE_ID = "dev.pmdr.menubar";
export const APP_BUNDLE_NAME = "pmdr.app";
/** `PRODUCT_NAME` of the `pmdr-menubar` target in `apps/menubar/project.yml`. */
export const APP_EXECUTABLE_NAME = "pmdr";

/** The Mach-O the app bundle actually runs — what a LaunchAgent invokes. */
export function appBinaryPath(appPath: string): string {
  return join(appPath, "Contents", "MacOS", APP_EXECUTABLE_NAME);
}

/** Where `pmdr app install` puts the bundle — per-user, so no sudo is ever needed. */
export function installedAppPath(home: string = homedir()): string {
  return join(home, "Applications", APP_BUNDLE_NAME);
}

/** The LaunchAgent plist that `pmdr app login --enable` writes. */
export function loginItemPlistPath(home: string = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${APP_BUNDLE_ID}.plist`);
}

export interface AppProbeDeps {
  home?: string;
  exists?: (path: string) => boolean;
  readAppVersion?: (appPath: string) => string | null;
  processRunning?: (appPath: string) => boolean;
}

export function createAppProbes(deps: AppProbeDeps = {}) {
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? existsSync;
  const readAppVersion = deps.readAppVersion ?? readAppVersionFromPlist;
  const processRunning = deps.processRunning ?? isAppProcessRunning;
  const appPath = installedAppPath(home);

  return {
    probeInstalled(): InstalledApp {
      if (!exists(appPath)) return { present: false };
      const version = readAppVersion(appPath);
      return version === null
        ? { present: false }
        : { present: true, appPath, version };
    },

    probeRunning(): boolean {
      return processRunning(appPath);
    },

    probeLoginItem(): boolean {
      return exists(loginItemPlistPath(home));
    },
  };
}

/** Reads `CFBundleShortVersionString` from an installed bundle. macOS only. */
export function readAppVersionFromPlist(appPath: string): string | null {
  try {
    const out = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", join(appPath, "Contents", "Info.plist")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * `pgrep -f` matches its pattern as an extended regex against the whole
 * argument list, so the bundle path's metacharacters (notably the `.` in
 * `pmdr.app`) have to be escaped or the match is looser than intended.
 */
export function appProcessPattern(appPath: string): string {
  return dirname(appBinaryPath(appPath)).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

/** True when a process is running out of the given app bundle. macOS only. */
export function isAppProcessRunning(appPath: string): boolean {
  try {
    execFileSync("/usr/bin/pgrep", ["-f", appProcessPattern(appPath)], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
