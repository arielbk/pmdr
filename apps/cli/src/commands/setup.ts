import { defineCommand } from "citty";
import { createMenubarApp, reportOutcome } from "../menubar-app.js";
import { createSetupMarkerStore } from "../setup-state.js";
import { createFirstRunPromptStore } from "../first-run-prompt.js";
import type { AppInstallState } from "../app-status.js";
import { cliVersion } from "../version.js";

export const NOT_A_TTY_MESSAGE =
  "pmdr setup: onboarding needs an interactive terminal — install the menubar app with `pmdr app install`, and launch it at login with `pmdr app login --enable`.";

export const CANCELLED_MESSAGE =
  "Setup cancelled. Run `pmdr setup` when you're ready.";

export type Answer = "yes" | "no" | "cancelled";

/** What the app step ended up doing, so the summary can be honest about it. */
export type AppStepOutcome =
  | "installed"
  | "already-installed"
  | "declined"
  | "unavailable"
  | "failed";

export interface SetupDeps {
  platform: string;
  version: string;
  confirm(message: string): Promise<Answer>;
  appInstallState(): AppInstallState;
  installApp(): { stdout: string[]; stderr: string[]; code: number };
  setLoginItem(enabled: boolean): {
    stdout: string[];
    stderr: string[];
    code: number;
  };
  /**
   * Remembers a "no" to the app, in the same place the first-run offer reads —
   * so declining here is not re-asked by the next bare `pmdr`.
   */
  recordAppDecline(): void;
  recordMarker(): void;
  stdout(line: string): void;
  stderr(line: string): void;
}

export type SetupResult =
  | { status: "cancelled" }
  | {
      status: "completed";
      app: AppStepOutcome;
      loginItem: boolean;
    };

/**
 * The onboarding `pmdr setup` runs, and that bare `pmdr` routes to on a fresh
 * install. It has exactly one job: get the menubar app installed. The CLI
 * itself needs no onboarding — every setting has a good default and a one-liner
 * (`pmdr config set …`, `pmdr project add …`) for changing it, so asking about
 * any of it up front would only be a question standing between someone and
 * their first pomodoro.
 *
 * Every prompt can be cancelled, and a cancelled setup writes no marker: the
 * next bare `pmdr` should offer to onboard again rather than silently deciding
 * the job was done.
 */
export async function runSetup(deps: SetupDeps): Promise<SetupResult> {
  const app = await setupApp(deps);
  if (app === "cancelled") return { status: "cancelled" };

  // Recorded before the summary and regardless of how the app step went: setup
  // did happen, and a failed install is a thing to retry with `pmdr app
  // install`, not a reason to onboard from scratch again.
  deps.recordMarker();

  for (const line of summaryLines({
    app: app.outcome,
    loginItem: app.loginItem,
  })) {
    deps.stdout(line);
  }

  return { status: "completed", app: app.outcome, loginItem: app.loginItem };
}

type AppStep = "cancelled" | { outcome: AppStepOutcome; loginItem: boolean };

/**
 * Offers the bundled menubar app, then launch-at-login. Asks nothing wherever
 * the app cannot exist — off macOS, or in a linked dev build with no bundled
 * zip — so setup never poses a question whose answer it could not act on.
 */
async function setupApp(deps: SetupDeps): Promise<AppStep> {
  if (deps.platform !== "darwin") {
    deps.stdout(
      "The pmdr menubar app is macOS only — the CLI is all there is here.",
    );
    return { outcome: "unavailable", loginItem: false };
  }

  const state = deps.appInstallState();
  if (state.bundledVersion === null) {
    deps.stdout(
      `This build has no menubar app bundled (${state.bundledReason ?? "reason unknown"}) — the CLI is ready to use.`,
    );
    return { outcome: "unavailable", loginItem: false };
  }

  const needsInstall = state.install === "absent" || state.install === "stale";
  if (needsInstall) {
    const message =
      state.install === "stale"
        ? `Update the menubar app to ${state.bundledVersion} and launch it?`
        : `Install the pmdr menubar app (${state.bundledVersion}) and launch it?`;
    const answer = await deps.confirm(message);
    if (answer === "cancelled") return "cancelled";
    if (answer === "no") {
      deps.recordAppDecline();
      deps.stdout(
        "Skipping the app. `pmdr app install` is there when you want it.",
      );
      return { outcome: "declined", loginItem: false };
    }

    const report = deps.installApp();
    for (const line of report.stdout) deps.stdout(line);
    for (const line of report.stderr) deps.stderr(line);
    if (report.code !== 0) {
      return { outcome: "failed", loginItem: false };
    }
  }

  const login = await deps.confirm("Launch the menubar app at login?");
  if (login === "cancelled") return "cancelled";

  const outcome: AppStepOutcome = needsInstall
    ? "installed"
    : "already-installed";
  if (login === "no") return { outcome, loginItem: false };

  const report = deps.setLoginItem(true);
  for (const line of report.stdout) deps.stdout(line);
  for (const line of report.stderr) deps.stderr(line);
  return { outcome, loginItem: report.code === 0 };
}

/** The closing summary: the handful of commands worth knowing on day one. */
export function summaryLines(result: {
  app: AppStepOutcome;
  loginItem: boolean;
}): string[] {
  const lines = [
    "",
    "Set up. From here:",
    "  pmdr           start a pomodoro",
    "  pmdr status    where the current session is at",
    "  pmdr today     what you got done today",
    "  pmdr project   attribute sessions to a project",
    "  pmdr config    durations, daily goal, sounds",
  ];
  if (result.app === "failed") {
    lines.push(
      "",
      "The menubar app did not install — retry with `pmdr app install`.",
    );
  }
  return lines;
}

export default defineCommand({
  meta: {
    description: "Set up pmdr: install the menubar app",
  },
  async run() {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      console.error(NOT_A_TTY_MESSAGE);
      process.exit(1);
    }

    const result = await runSetup(await realSetupDeps());

    if (result.status === "cancelled") {
      console.log(CANCELLED_MESSAGE);
      process.exit(1);
    }
  },
});

/** Binds `runSetup` to clack prompts and the real bundled app. */
export async function realSetupDeps(): Promise<SetupDeps> {
  const { confirm, isCancel } = await import("@clack/prompts");
  const app = createMenubarApp();
  const marker = createSetupMarkerStore();
  const version = cliVersion();

  return {
    platform: process.platform,
    version,
    async confirm(message) {
      const answer = await confirm({ message });
      if (isCancel(answer)) return "cancelled";
      return answer ? "yes" : "no";
    },
    appInstallState: () => app.installState(),
    installApp: () => reportOutcome(app.install()),
    setLoginItem: (enabled) => reportOutcome(app.setLoginItem(enabled)),
    recordAppDecline: () => {
      try {
        createFirstRunPromptStore().recordDecline(
          app.installState().bundledVersion ?? "unknown",
        );
      } catch {
        // Best-effort: the worst case is being offered the app once more.
      }
    },
    recordMarker: () =>
      marker.record({ completedAt: new Date().toISOString(), version }),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  };
}
