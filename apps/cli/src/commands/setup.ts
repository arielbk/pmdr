import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProjectsModule, type ProjectRecord } from "../projects.js";
import { createMenubarApp, reportOutcome } from "../menubar-app.js";
import { createSetupMarkerStore } from "../setup-state.js";
import { createFirstRunPromptStore } from "../first-run-prompt.js";
import type { AppInstallState } from "../app-status.js";
import { cliVersion } from "../version.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");
const UNASSIGNED_PROJECT = "(unassigned)";
const SKIP_VALUE = "__skip__";
const NEW_PROJECT_VALUE = "__new__";

export const NOT_A_TTY_MESSAGE =
  "pmdr setup: onboarding needs an interactive terminal — set durations with `pmdr config set <key> <value>`, projects with `pmdr project add <name>`, and the menubar app with `pmdr app install`.";

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
  /** A free-text answer, or null when the prompt was cancelled. */
  askText(message: string): Promise<string | null>;
  /** A chosen option value, or null when the prompt was cancelled. */
  askSelect(
    message: string,
    options: Array<{ value: string; label: string; hint?: string }>,
  ): Promise<string | null>;
  listProjects(): ProjectRecord[];
  upsertProject(name: string): ProjectRecord;
  writeLastProject(name: string): void;
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
      project: string | null;
      app: AppStepOutcome;
      loginItem: boolean;
    };

/**
 * The onboarding `pmdr setup` runs, and that bare `pmdr` routes to on a fresh
 * install. Two steps only — a project to attribute sessions to, and the menubar
 * app — because everything else already has a good default and a one-liner
 * (`pmdr config set …`) for changing it. Asking about seven config keys up front
 * is how onboarding becomes something people quit halfway through.
 *
 * Every prompt can be cancelled, and a cancelled setup writes no marker: the
 * next bare `pmdr` should offer to onboard again rather than silently deciding
 * the job was done.
 */
export async function runSetup(deps: SetupDeps): Promise<SetupResult> {
  deps.stdout("Setting up pmdr. Two questions, both skippable.\n");

  const project = await setupProject(deps);
  if (project === "cancelled") return { status: "cancelled" };

  const app = await setupApp(deps);
  if (app === "cancelled") return { status: "cancelled" };

  // Recorded before the summary and regardless of how the app step went: setup
  // did happen, and a failed install is a thing to retry with `pmdr app
  // install`, not a reason to onboard from scratch again.
  deps.recordMarker();

  for (const line of summaryLines({
    project,
    app: app.outcome,
    loginItem: app.loginItem,
  })) {
    deps.stdout(line);
  }

  return {
    status: "completed",
    project,
    app: app.outcome,
    loginItem: app.loginItem,
  };
}

/**
 * Picks the project new sessions get attributed to. Existing projects are
 * offered as a list — a fresh install has none, so that path goes straight to
 * asking for a name instead of showing a list with only "new…" in it.
 */
async function setupProject(
  deps: SetupDeps,
): Promise<string | null | "cancelled"> {
  const existing = deps.listProjects();

  let name: string | null;
  if (existing.length > 0) {
    const selected = await deps.askSelect(
      "Which project are your sessions for?",
      [
        ...existing.map((p) => ({ value: p.name, label: p.name })),
        { value: NEW_PROJECT_VALUE, label: "new…" },
        {
          value: SKIP_VALUE,
          label: "skip",
          hint: "sessions land in (unassigned)",
        },
      ],
    );
    if (selected === null) return "cancelled";
    if (selected === SKIP_VALUE) return null;
    name =
      selected === NEW_PROJECT_VALUE
        ? await deps.askText("Project name:")
        : selected;
  } else {
    name = await deps.askText(
      "Which project are your sessions for? (blank to skip)",
    );
  }

  if (name === null) return "cancelled";

  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === UNASSIGNED_PROJECT) {
    deps.stderr(
      `"${UNASSIGNED_PROJECT}" is reserved — skipping the project step.`,
    );
    return null;
  }

  const record = deps.upsertProject(trimmed);
  // Written so the very next `pmdr start` picks it up without --project.
  deps.writeLastProject(record.name);
  return record.name;
}

type AppStep = "cancelled" | { outcome: AppStepOutcome; loginItem: boolean };

/**
 * Offers the bundled menubar app, then launch-at-login. Silent wherever the app
 * cannot exist — off macOS, or in a linked dev build with no bundled zip — so
 * setup never asks a question whose answer it could not act on.
 */
async function setupApp(deps: SetupDeps): Promise<AppStep> {
  if (deps.platform !== "darwin") {
    return { outcome: "unavailable", loginItem: false };
  }

  const state = deps.appInstallState();
  if (state.bundledVersion === null) {
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

/** The closing summary: what setup did, and the two commands worth knowing. */
export function summaryLines(result: {
  project: string | null;
  app: AppStepOutcome;
  loginItem: boolean;
}): string[] {
  const lines = ["", "Set up. From here:"];
  lines.push(
    result.project
      ? `  pmdr           start a pomodoro for ${result.project}`
      : "  pmdr           start a pomodoro",
  );
  lines.push("  pmdr status    where the current session is at");
  lines.push("  pmdr today     what you got done today");
  lines.push("  pmdr config    durations, daily goal, sounds");
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
    description: "Set up pmdr: pick a project and install the menubar app",
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

/** Binds `runSetup` to clack prompts, the real state dir and the real app. */
export async function realSetupDeps(): Promise<SetupDeps> {
  const { confirm, isCancel, select, text } = await import("@clack/prompts");
  const projects = createProjectsModule(STATE_DIR);
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
    async askText(message) {
      const answer = await text({ message, placeholder: "" });
      if (isCancel(answer)) return null;
      return typeof answer === "string" ? answer : "";
    },
    async askSelect(message, options) {
      const answer = await select({ message, options });
      if (isCancel(answer)) return null;
      return String(answer);
    },
    listProjects: () => projects.listProjects({ includeArchived: false }),
    upsertProject: (name) => projects.upsertProject(name),
    writeLastProject: (name) => projects.writeLastProject(name),
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
