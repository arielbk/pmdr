import { defineCommand } from "citty";
import { createMenubarApp, reportOutcome } from "../menubar-app.js";
import { createSetupMarkerStore } from "../setup-state.js";
import { createFirstRunPromptStore } from "../first-run-prompt.js";
import type { AppInstallState } from "../app-status.js";
import {
  SKILL_ADD_HINT,
  SKILL_UPDATE_HINT,
  createAgentSkill,
} from "../agent-skill.js";
import type { SkillInstallState } from "../agent-skill.js";
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

/** The same, for the agent skill. `unavailable` is silent — see `setupSkill`. */
export type SkillStepOutcome =
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
  /** Whether the agent skill is installed, installable, or not a thing here. */
  skillState(): SkillInstallState;
  /** Runs the installer with its own output going to the terminal. */
  installSkill(): { ok: boolean };
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
      skill: SkillStepOutcome;
    };

/**
 * The onboarding `pmdr setup` runs, and that bare `pmdr` routes to on a fresh
 * install. It installs things — the menubar app, and the agent skill where an
 * agent exists to use it — and asks about nothing else. The CLI itself needs no
 * onboarding: every setting has a good default and a one-liner (`pmdr config
 * set …`, `pmdr project add …`) for changing it, so asking about any of it up
 * front would only be a question standing between someone and their first
 * pomodoro.
 *
 * Neither install step asks a question it could not act on, so the number of
 * prompts tracks what this machine can actually use: two on a Mac with a coding
 * agent, none at all on a Linux box without one.
 *
 * Every prompt can be cancelled, and a cancelled setup writes no marker: the
 * next bare `pmdr` should offer to onboard again rather than silently deciding
 * the job was done.
 */
export async function runSetup(deps: SetupDeps): Promise<SetupResult> {
  const app = await setupApp(deps);
  if (app === "cancelled") return { status: "cancelled" };

  const skill = await setupSkill(deps);
  if (skill === "cancelled") return { status: "cancelled" };

  // Recorded before the summary and regardless of how either step went: setup
  // did happen, and a failed install is a thing to retry with `pmdr app
  // install`, not a reason to onboard from scratch again.
  deps.recordMarker();

  for (const line of summaryLines({
    app: app.outcome,
    loginItem: app.loginItem,
    skill,
  })) {
    deps.stdout(line);
  }

  return {
    status: "completed",
    app: app.outcome,
    loginItem: app.loginItem,
    skill,
  };
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

/**
 * Offers the agent skill — the SKILL.md that teaches a coding agent to drive
 * this CLI non-interactively.
 *
 * Says nothing at all unless there is a decision to make. Someone who has it
 * already needs no confirmation, and someone with no agent on the machine has
 * never heard of agent skills and should not be told why they cannot have one:
 * on the way to a first pomodoro that is pure noise. This is the same rule the
 * app step follows, and it is what keeps setup's prompts to things this machine
 * can actually use.
 */
async function setupSkill(
  deps: SetupDeps,
): Promise<"cancelled" | SkillStepOutcome> {
  const state = deps.skillState();
  if (state.install === "installed") return "already-installed";
  if (state.install === "unavailable") return "unavailable";

  const answer = await deps.confirm(
    `Install the pmdr agent skill, so coding agents can drive the timer? (${SKILL_ADD_HINT})`,
  );
  if (answer === "cancelled") return "cancelled";
  if (answer === "no") {
    deps.stdout(`Skipping the skill. \`${SKILL_ADD_HINT}\` adds it later.`);
    return "declined";
  }

  return deps.installSkill().ok ? "installed" : "failed";
}

/** The closing summary: the handful of commands worth knowing on day one. */
export function summaryLines(result: {
  app: AppStepOutcome;
  loginItem: boolean;
  skill: SkillStepOutcome;
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
  if (result.skill === "installed") {
    // The skill is pinned to the commit it was fetched at, so upgrading the CLI
    // leaves it describing an older one. Naming the resync here is the only
    // place someone reliably sees it.
    lines.push(
      "",
      `Agent skill installed — keep it in step with the CLI using \`${SKILL_UPDATE_HINT}\`.`,
    );
  }
  if (result.skill === "failed") {
    lines.push(
      "",
      `The agent skill did not install — retry with \`${SKILL_ADD_HINT}\`.`,
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
  const skill = createAgentSkill();
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
    skillState: () => skill.state(),
    installSkill: () => skill.install(),
    recordMarker: () =>
      marker.record({ completedAt: new Date().toISOString(), version }),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  };
}
