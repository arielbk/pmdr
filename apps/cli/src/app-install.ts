import {
  installedAppPath,
  loginItemPlistPath,
} from "./app-probes.js";
import { compareVersions } from "./app-status.js";
import type { InstalledApp } from "./app-status.js";
import type { BundledApp } from "./bundled-app.js";
import type { MenubarAppSystem } from "./menubar-app-system.js";

export interface AppInstallRunDeps {
  home: string;
  force?: boolean;
  noLaunch?: boolean;
  bundled: { locate(): BundledApp };
  probes: { probeInstalled(): InstalledApp; probeRunning(): boolean };
  system: MenubarAppSystem;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppInstall(deps: AppInstallRunDeps): number {
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

  try {
    deps.system.replaceBundle({
      zipPath: bundled.zipPath,
      appPath,
      // Quit only once a good replacement is staged, so a failed extract never
      // leaves the user with a killed app and nothing to launch.
      beforeSwap: () => {
        if (deps.probes.probeRunning()) deps.system.quitApp();
      },
    });
  } catch (error) {
    deps.stderr(`pmdr app install: ${messageOf(error)}`);
    return 1;
  }

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
  home: string;
  probes: { probeRunning(): boolean };
  system: MenubarAppSystem;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppUninstall(deps: AppUninstallRunDeps): number {
  const appPath = installedAppPath(deps.home);
  const plistPath = loginItemPlistPath(deps.home);
  const removed: string[] = [];

  try {
    if (deps.probes.probeRunning()) deps.system.quitApp();
    if (deps.system.removePath(appPath)) removed.push(appPath);
    // The login item points at the bundle we just removed, so it goes too —
    // otherwise login would keep trying to launch an app that isn't there.
    if (deps.system.removePath(plistPath)) removed.push(plistPath);
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
