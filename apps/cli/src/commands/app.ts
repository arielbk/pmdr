import { homedir } from "node:os";
import { defineCommand } from "citty";
import {
  installOptionsFromArgs,
  runAppInstall,
  runAppUninstall,
} from "../app-install.js";
import { createAppProbes } from "../app-probes.js";
import { deriveAppStatus, formatAppStatus } from "../app-status.js";
import type { InstalledApp } from "../app-status.js";
import { createBundledAppModule } from "../bundled-app.js";
import { loginActionFromArgs, runAppLogin } from "../login-item.js";
import { createMenubarAppSystem } from "../menubar-app-system.js";
import type { BundledApp } from "../bundled-app.js";

export function nonMacosMessage(action: string): string {
  return `pmdr app: the menubar app is macOS only — nothing to ${action} on this platform`;
}

export interface MacosGateDeps {
  platform: string;
  /** The verb that goes in the refusal: "install", "report", "configure"… */
  action: string;
  stderr: (line: string) => void;
  run: () => number;
}

/**
 * The one place `pmdr app` refuses to run off macOS. Every subcommand goes
 * through here, so nothing behind it has to know what platform it is on.
 */
export function runOnMacos(deps: MacosGateDeps): number {
  if (deps.platform !== "darwin") {
    deps.stderr(nonMacosMessage(deps.action));
    return 1;
  }
  return deps.run();
}

export interface AppStatusRunDeps {
  json: boolean;
  bundled: { locate(): BundledApp };
  probes: {
    probeInstalled(): InstalledApp;
    probeRunning(): boolean;
    probeLoginItem(): boolean;
  };
  stdout: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppStatus(deps: AppStatusRunDeps): number {
  const status = deriveAppStatus({
    bundled: deps.bundled.locate(),
    installed: deps.probes.probeInstalled(),
    running: deps.probes.probeRunning(),
    loginItem: deps.probes.probeLoginItem(),
  });

  deps.stdout(deps.json ? JSON.stringify(status) : formatAppStatus(status));
  return 0;
}

/** Binds the gate to the real process: refuse off macOS, otherwise run and exit. */
function exitWith(action: string, run: () => number): void {
  const code = runOnMacos({
    platform: process.platform,
    action,
    stderr: (line) => console.error(line),
    run,
  });
  if (code !== 0) process.exit(code);
}

const statusCmd = defineCommand({
  meta: { description: "Show whether the menubar app is installed and running" },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run({ args }) {
    exitWith("report", () =>
      runAppStatus({
        json: args.json === true,
        bundled: createBundledAppModule(),
        probes: createAppProbes(),
        stdout: (line) => console.log(line),
      }),
    );
  },
});

const installCmd = defineCommand({
  meta: { description: "Install the bundled menubar app into ~/Applications" },
  args: {
    force: {
      type: "boolean",
      description: "Reinstall even when the same version is already installed",
    },
    launch: {
      type: "boolean",
      default: true,
      description: "Launch the app after installing (use --no-launch to skip)",
    },
  },
  run({ args }) {
    const home = homedir();
    exitWith("install", () =>
      runAppInstall({
        home,
        ...installOptionsFromArgs(args),
        bundled: createBundledAppModule(),
        probes: createAppProbes(),
        system: createMenubarAppSystem(home),
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      }),
    );
  },
});

const loginCmd = defineCommand({
  meta: { description: "Enable or disable launching the menubar app at login" },
  args: {
    enable: { type: "boolean", description: "Launch the app at login" },
    disable: { type: "boolean", description: "Stop launching the app at login" },
  },
  run({ args }) {
    const parsed = loginActionFromArgs(args);
    if ("error" in parsed) {
      console.error(parsed.error);
      process.exit(1);
    }

    const home = homedir();
    exitWith("configure", () =>
      runAppLogin({
        home,
        action: parsed.action,
        probes: createAppProbes(),
        system: createMenubarAppSystem(home),
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      }),
    );
  },
});

const uninstallCmd = defineCommand({
  meta: { description: "Remove the menubar app and any launch-at-login item" },
  run() {
    const home = homedir();
    exitWith("uninstall", () =>
      runAppUninstall({
        home,
        probes: createAppProbes(),
        system: createMenubarAppSystem(home),
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      }),
    );
  },
});

export default defineCommand({
  meta: { description: "Manage the macOS menubar app" },
  subCommands: {
    status: statusCmd,
    install: installCmd,
    login: loginCmd,
    uninstall: uninstallCmd,
  },
});
