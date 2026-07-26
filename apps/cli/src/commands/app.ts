import { defineCommand } from "citty";
import { renderAppStatus } from "../app-status.js";
import { loginActionFromArgs } from "../login-item.js";
import { createMenubarApp, reportOutcome } from "../menubar-app.js";
import type { OutcomeReport } from "../menubar-app.js";

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

/** Binds the gate to the real process: refuse off macOS, otherwise run and exit. */
function exitWith(action: string, run: () => OutcomeReport): void {
  const code = runOnMacos({
    platform: process.platform,
    action,
    stderr: (line) => console.error(line),
    run: () => {
      const report = run();
      for (const line of report.stdout) console.log(line);
      for (const line of report.stderr) console.error(line);
      return report.code;
    },
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
    exitWith("report", () => ({
      stdout: [renderAppStatus(createMenubarApp().status(), args.json === true)],
      stderr: [],
      code: 0,
    }));
  },
});

const installCmd = defineCommand({
  meta: { description: "Install the bundled menubar app into ~/Applications" },
  args: {
    force: {
      type: "boolean",
      description: "Reinstall even when the same version is already installed",
    },
    /**
     * citty parses `--no-launch` as a negation of a `launch` flag, not as an
     * arg literally named `no-launch` — so the flag has to be declared as
     * `launch`, or `--no-launch` silently does nothing.
     */
    launch: {
      type: "boolean",
      default: true,
      description: "Launch the app after installing (use --no-launch to skip)",
    },
  },
  run({ args }) {
    exitWith("install", () =>
      reportOutcome(
        createMenubarApp().install({
          force: args.force === true,
          launch: args.launch !== false,
        }),
      ),
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

    exitWith("configure", () =>
      reportOutcome(createMenubarApp().setLoginItem(parsed.enabled)),
    );
  },
});

const uninstallCmd = defineCommand({
  meta: { description: "Remove the menubar app and any launch-at-login item" },
  run() {
    exitWith("uninstall", () => reportOutcome(createMenubarApp().uninstall()));
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
