import { homedir } from "node:os";
import {
  appBinaryPath,
  createAppProbes,
  installedAppPath,
  loginItemPlistPath,
} from "./app-probes.js";
import type { AppProbes } from "./app-probes.js";
import {
  compareVersions,
  deriveAppStatus,
  deriveInstallState,
} from "./app-status.js";
import type { AppInstallState, AppStatus } from "./app-status.js";
import { createBundledAppModule } from "./bundled-app.js";
import type { BundledApp } from "./bundled-app.js";
import { loginItemPlist } from "./login-item.js";
import { createMenubarAppSystem } from "./menubar-app-system.js";
import type { MenubarAppSystem } from "./menubar-app-system.js";

/** Something went wrong doing `action`. `reason` is already human-readable. */
export interface MenubarAppFailure {
  kind: "failed";
  action: "install" | "uninstall" | "login";
  reason: string;
}

export type InstallOutcome =
  | { kind: "already-current"; version: string; appPath: string }
  | { kind: "installed"; version: string; appPath: string }
  | {
      kind: "installed-not-launched";
      version: string;
      appPath: string;
      reason: string;
    }
  | { kind: "no-bundled-app"; reason: string }
  | MenubarAppFailure;

export type UninstallOutcome =
  | { kind: "removed"; paths: string[] }
  | { kind: "nothing-to-remove" }
  | MenubarAppFailure;

export type LoginItemOutcome =
  | { kind: "login-item-set"; enabled: boolean }
  | { kind: "app-not-installed" }
  | MenubarAppFailure;

export type MenubarAppOutcome =
  | InstallOutcome
  | UninstallOutcome
  | LoginItemOutcome;

export interface InstallOptions {
  /** Reinstall even when the bundled version is already the installed one. */
  force?: boolean;
  /** Launch the app once it is in place. Defaults to true. */
  launch?: boolean;
}

/**
 * Everything the CLI knows how to do with the macOS menubar app. Nothing here
 * prints, exits, or checks the platform — callers turn an outcome into output
 * with `reportOutcome`, and `pmdr app` refuses off macOS before it gets here.
 */
export interface MenubarApp {
  /** Filesystem only — no `pgrep`, no login-item lookup. */
  installState(): AppInstallState;
  status(): AppStatus;
  install(options?: InstallOptions): InstallOutcome;
  uninstall(): UninstallOutcome;
  setLoginItem(enabled: boolean): LoginItemOutcome;
}

export interface MenubarAppDeps {
  home?: string;
  bundled?: { locate(): BundledApp };
  probes?: AppProbes;
  system?: MenubarAppSystem;
}

export function createMenubarApp(deps: MenubarAppDeps = {}): MenubarApp {
  const home = deps.home ?? homedir();
  const bundled = deps.bundled ?? createBundledAppModule();
  const probes = deps.probes ?? createAppProbes({ home });
  const system = deps.system ?? createMenubarAppSystem(home);
  const appPath = installedAppPath(home);
  const plistPath = loginItemPlistPath(home);

  return {
    installState() {
      return deriveInstallState(bundled.locate(), probes.probeInstalled());
    },

    status() {
      return deriveAppStatus({
        bundled: bundled.locate(),
        installed: probes.probeInstalled(),
        running: probes.probeRunning(),
        loginItem: probes.probeLoginItem(),
      });
    },

    install(options = {}) {
      const carried = bundled.locate();
      if (!carried.present) {
        return { kind: "no-bundled-app", reason: carried.reason };
      }

      const installed = probes.probeInstalled();
      if (
        installed.present &&
        options.force !== true &&
        compareVersions(installed.version, carried.version) === 0
      ) {
        return { kind: "already-current", version: installed.version, appPath };
      }

      try {
        system.replaceBundle({
          zipPath: carried.zipPath,
          appPath,
          beforeSwap: () => {
            if (probes.probeRunning()) system.quitApp();
          },
        });
      } catch (error) {
        return { kind: "failed", action: "install", reason: messageOf(error) };
      }

      if (options.launch === false) {
        return { kind: "installed", version: carried.version, appPath };
      }

      try {
        system.launchApp(appPath);
      } catch (error) {
        return {
          kind: "installed-not-launched",
          version: carried.version,
          appPath,
          reason: messageOf(error),
        };
      }
      return { kind: "installed", version: carried.version, appPath };
    },

    uninstall() {
      const removed: string[] = [];

      try {
        if (probes.probeRunning()) system.quitApp();
        if (system.removePath(appPath)) removed.push(appPath);
        // The login item points at the bundle we just removed, so it goes too —
        // otherwise login would keep trying to launch an app that isn't there.
        if (system.removePath(plistPath)) removed.push(plistPath);
      } catch (error) {
        return { kind: "failed", action: "uninstall", reason: messageOf(error) };
      }

      return removed.length === 0
        ? { kind: "nothing-to-remove" }
        : { kind: "removed", paths: removed };
    },

    setLoginItem(enabled) {
      try {
        // Disabling must work even with the app already gone — otherwise an
        // uninstall could strand an agent nobody can turn off. So this path
        // deliberately never asks whether the app is installed.
        if (!enabled) {
          system.removePath(plistPath);
          return { kind: "login-item-set", enabled: false };
        }

        // The agent has to name a real binary, so there is nothing honest to
        // write before the app exists on disk.
        const installed = probes.probeInstalled();
        if (!installed.present) return { kind: "app-not-installed" };

        system.writeLoginItem(
          plistPath,
          loginItemPlist(appBinaryPath(installed.appPath)),
        );
        return { kind: "login-item-set", enabled: true };
      } catch (error) {
        return { kind: "failed", action: "login", reason: messageOf(error) };
      }
    },
  };
}

export interface OutcomeReport {
  stdout: string[];
  stderr: string[];
  code: number;
}

/** Every line `pmdr app` can print about an outcome, and the exit code with it. */
export function reportOutcome(outcome: MenubarAppOutcome): OutcomeReport {
  switch (outcome.kind) {
    case "already-current":
      return ok(`App: ${outcome.version} already installed at ${outcome.appPath}`);
    case "installed":
      return ok(`App: ${outcome.version} installed at ${outcome.appPath}`);
    case "installed-not-launched":
      // The bundle is in place; only the launch failed. Say exactly that, and
      // still exit non-zero so scripts don't assume a running menubar app.
      return {
        stdout: [`App: ${outcome.version} installed at ${outcome.appPath}`],
        stderr: [
          `pmdr app install: installed but could not be launched — ${outcome.reason}`,
        ],
        code: 1,
      };
    case "no-bundled-app":
      return fail(`pmdr app install: ${outcome.reason}`);
    case "removed":
      return ok(`App: removed ${outcome.paths.join(" and ")}`);
    case "nothing-to-remove":
      return ok("App: not installed, nothing to remove");
    case "login-item-set":
      return ok(`Launch at login: ${outcome.enabled ? "enabled" : "disabled"}`);
    case "app-not-installed":
      return fail(
        "pmdr app login: the menubar app is not installed — run `pmdr app install` first",
      );
    case "failed":
      return fail(`pmdr app ${outcome.action}: ${outcome.reason}`);
  }
}

function ok(line: string): OutcomeReport {
  return { stdout: [line], stderr: [], code: 0 };
}

function fail(line: string): OutcomeReport {
  return { stdout: [], stderr: [line], code: 1 };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
