import type { BundledApp } from "./bundled-app.js";

/** The app bundle as found (or not) in the user's Applications directory. */
export type InstalledApp =
  | { present: true; appPath: string; version: string }
  | { present: false };

export interface AppStatusInputs {
  bundled: BundledApp;
  installed: InstalledApp;
  running: boolean;
  loginItem: boolean;
}

export interface AppStatus {
  install: "absent" | "current" | "stale" | "unknown";
  installedVersion: string | null;
  installedPath: string | null;
  bundledVersion: string | null;
  bundledReason: string | null;
  running: boolean;
  loginItem: boolean;
}

/**
 * Compare dotted numeric versions (`CFBundleShortVersionString` style).
 * Returns <0, 0 or >0 like a sort comparator. Non-numeric parts count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function deriveInstallState(
  bundled: BundledApp,
  installed: InstalledApp,
): AppStatus["install"] {
  if (!installed.present) return "absent";
  if (!bundled.present) return "unknown";
  return compareVersions(bundled.version, installed.version) > 0
    ? "stale"
    : "current";
}

export function deriveAppStatus(inputs: AppStatusInputs): AppStatus {
  const { bundled, installed, running, loginItem } = inputs;

  return {
    install: deriveInstallState(bundled, installed),
    installedVersion: installed.present ? installed.version : null,
    installedPath: installed.present ? installed.appPath : null,
    bundledVersion: bundled.present ? bundled.version : null,
    bundledReason: bundled.present ? null : bundled.reason,
    running,
    loginItem,
  };
}

function formatInstallLine(status: AppStatus): string {
  switch (status.install) {
    case "absent":
      return status.bundledVersion === null
        ? `App: not installed (${status.bundledReason})`
        : `App: not installed — ${status.bundledVersion} bundled with this CLI, run \`pmdr app install\``;
    case "current":
      return `App: ${status.installedVersion} installed, up to date`;
    case "stale":
      return `App: ${status.installedVersion} installed — ${status.bundledVersion} bundled with this CLI, run \`pmdr app install\` to update`;
    case "unknown":
      return `App: ${status.installedVersion} installed (${status.bundledReason}, cannot compare)`;
  }
}

export function formatAppStatus(status: AppStatus): string {
  return [
    formatInstallLine(status),
    `Running: ${status.running ? "yes" : "no"}`,
    `Launch at login: ${status.loginItem ? "on" : "off"}`,
  ].join("\n");
}
