import { homedir } from "node:os";
import { defineCommand } from "citty";
import {
  createInstallSystem,
  installOptionsFromArgs,
  runAppInstall,
  runAppUninstall,
} from "../app-install.js";
import { createAppProbes } from "../app-probes.js";
import { deriveAppStatus, formatAppStatus } from "../app-status.js";
import type { InstalledApp } from "../app-status.js";
import { createBundledAppModule } from "../bundled-app.js";
import type { BundledApp } from "../bundled-app.js";

export const NON_MACOS_MESSAGE =
  "pmdr app: the menubar app is macOS only — nothing to report on this platform";

export interface AppStatusRunDeps {
  platform: string;
  json: boolean;
  bundled: { locate(): BundledApp };
  probes: {
    probeInstalled(): InstalledApp;
    probeRunning(): boolean;
    probeLoginItem(): boolean;
  };
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Returns the process exit code so the command stays testable end to end. */
export function runAppStatus(deps: AppStatusRunDeps): number {
  if (deps.platform !== "darwin") {
    deps.stderr(NON_MACOS_MESSAGE);
    return 1;
  }

  const status = deriveAppStatus({
    bundled: deps.bundled.locate(),
    installed: deps.probes.probeInstalled(),
    running: deps.probes.probeRunning(),
    loginItem: deps.probes.probeLoginItem(),
  });

  deps.stdout(deps.json ? JSON.stringify(status) : formatAppStatus(status));
  return 0;
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
    const code = runAppStatus({
      platform: process.platform,
      json: args.json === true,
      bundled: createBundledAppModule(),
      probes: createAppProbes(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exit(code);
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
    const code = runAppInstall({
      platform: process.platform,
      home,
      ...installOptionsFromArgs(args),
      bundled: createBundledAppModule(),
      probes: createAppProbes(),
      system: createInstallSystem(home),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exit(code);
  },
});

const uninstallCmd = defineCommand({
  meta: { description: "Remove the menubar app and any launch-at-login item" },
  run() {
    const home = homedir();
    const code = runAppUninstall({
      platform: process.platform,
      home,
      probes: createAppProbes(),
      system: createInstallSystem(home),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exit(code);
  },
});

export default defineCommand({
  meta: { description: "Manage the macOS menubar app" },
  subCommands: {
    status: statusCmd,
    install: installCmd,
    uninstall: uninstallCmd,
  },
});
