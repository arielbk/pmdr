import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDuration } from "../parse-duration.js";
import {
  createStateModule,
  deriveState,
  type StateRecord,
} from "../state.js";
import { createProjectsModule } from "../projects.js";
import { createConfigModule } from "../config.js";
import { select, text, cancel, isCancel } from "@clack/prompts";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");
const UNASSIGNED_PROJECT = "(unassigned)";
type ConfigReader = Pick<
  ReturnType<typeof createConfigModule>,
  "readEffectiveConfig"
>;

export function resolveStartDurationMs(
  durationArg: string | undefined,
  config: ConfigReader = createConfigModule(),
): number {
  return durationArg
    ? parseDuration(durationArg)
    : config.readEffectiveConfig().focusMinutes * 60_000;
}

export function initTimer(options: {
  store: ReturnType<typeof createStateModule>;
  durationMs: number;
  now: number;
  project?: string;
  id?: string;
  force?: boolean;
}): void {
  const { store, durationMs, now } = options;
  const project = options.project ?? UNASSIGNED_PROJECT;

  // Advance first so an expired focus still gets its completion logged, even
  // when force then discards the resulting pending break.
  store.advancePhaseIfExpired(now);
  if (options.force) {
    store.clearState();
  }

  const file = store.readState();
  const derived = deriveState({ file, now });

  if (derived.kind === "running") {
    throw new Error("A pomodoro is already running.");
  }
  if (derived.kind === "paused") {
    throw new Error("A pomodoro is paused. Resume or stop it first.");
  }

  const id = options.id ?? randomUUID();
  store.writeState({
    startedAt: now,
    durationMs,
    pausedAt: null,
    accumulatedPauseMs: 0,
    project,
    phase: "focus",
    completedFocusBlocks: 0,
    id,
  });
  store.appendEvent({ type: "start", at: now, id, project });
}

const NEW_PROJECT_VALUE = "__new__";

type SelectFn = (opts: {
  message: string;
  options: Array<{ value: string; label: string }>;
}) => Promise<string | symbol>;

type TextFn = (opts: {
  message: string;
  validate?: (v: string) => string | undefined;
}) => Promise<string | symbol>;

type ProjectResolver = Pick<
  ReturnType<typeof createProjectsModule>,
  "upsertProject"
>;

type LastProjectResolver = Pick<
  ReturnType<typeof createProjectsModule>,
  "resolveLastActiveProject"
>;

export function resolveStartProject(
  projectArg: string | undefined,
  projects: ProjectResolver,
  lastProjectResolver?: LastProjectResolver,
): string {
  if (projectArg) return projects.upsertProject(projectArg).name;
  const last = lastProjectResolver?.resolveLastActiveProject() ?? null;
  if (last) return last;
  return UNASSIGNED_PROJECT;
}

export async function pickProject(options: {
  projects: ReturnType<typeof createProjectsModule>;
  selectFn?: SelectFn;
  textFn?: TextFn;
  isCancelFn?: (value: unknown) => boolean;
  cancelFn?: (message: string) => void;
}): Promise<string> {
  const { projects } = options;
  const selectFn = options.selectFn ?? (select as SelectFn);
  const textFn = options.textFn ?? (text as TextFn);
  const isCancelFn = options.isCancelFn ?? isCancel;
  const cancelFn = options.cancelFn ?? cancel;

  const nonArchived = projects.listProjects({ includeArchived: false });

  const selected = await selectFn({
    message: "Select a project:",
    options: [
      ...nonArchived.map((p) => ({ value: p.name, label: p.name })),
      { value: NEW_PROJECT_VALUE, label: "new…" },
    ],
  });

  if (isCancelFn(selected)) {
    cancelFn("No project selected.");
    process.exit(1);
  }

  if (selected === NEW_PROJECT_VALUE) {
    const name = await textFn({
      message: "Project name:",
      validate: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return "Name is required";
        if (trimmed.toLowerCase() === "(unassigned)")
          return '"(unassigned)" is reserved';
        if (trimmed.length > 100) return "Name must be 100 characters or less";
      },
    });

    if (isCancelFn(name)) {
      cancelFn("No project name entered.");
      process.exit(1);
    }

    return projects.upsertProject(name as string).name;
  }

  return projects.upsertProject(selected as string).name;
}

export function countdownCompleteMessage(file: StateRecord | null): string {
  if (file?.phase === "break" && file.pausedAt !== null) {
    return "Pomodoro complete! Break ready — run `pmdr resume` to start it.";
  }
  return "Pomodoro complete!";
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const SCRIPTED_TIMER_NOTE =
  "Not a terminal, so the countdown is not rendered — read the session with `pmdr status --json`.";

export type CountdownMode =
  | { render: true }
  | { render: false; note: string | null };

/**
 * Whether to render the live countdown, and what to say instead.
 *
 * The countdown repaints one line with `\r`, which only means anything on a
 * terminal: piped into a file or a script it is noise, and worse, it keeps the
 * process alive for the whole pomodoro. So a non-TTY stdout starts the timer and
 * returns, the same as `--detach`, with one line pointing at the JSON status.
 * `--detach` itself stays silent — it was asked for explicitly.
 */
export function decideCountdown(inputs: {
  detach: boolean;
  stdoutIsTty: boolean;
}): CountdownMode {
  if (inputs.detach) return { render: false, note: null };
  if (!inputs.stdoutIsTty) return { render: false, note: SCRIPTED_TIMER_NOTE };
  return { render: true };
}

/**
 * What bare `pmdr` prints before attaching to a session that is already going.
 * The countdown below reports the remaining time and whether it is paused, so
 * this line only has to say what you are looking at.
 */
export function attachBanner(file: StateRecord): string {
  const phase = file.phase === "break" ? "break" : "focus";
  return `Attached to the current ${phase} session. [${file.project ?? UNASSIGNED_PROJECT}]`;
}

export async function runCountdown(
  store: ReturnType<typeof createStateModule>,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const now = Date.now();
      const file = store.readState();

      if (!file) {
        clearInterval(interval);
        process.stdout.write("\r\x1b[K");
        console.log("Timer stopped.");
        resolve();
        return;
      }

      const derived = deriveState({ file, now });

      if (derived.kind === "paused") {
        process.stdout.write(
          `\r\x1b[K  ${formatRemaining(derived.remainingMs)} remaining (paused)`,
        );
        return;
      }

      if (derived.kind === "expired") {
        store.advancePhaseIfExpired(now);
        clearInterval(interval);
        process.stdout.write("\r\x1b[K");
        process.stdout.write(
          `${countdownCompleteMessage(store.readState())}\x07\n`,
        );
        resolve();
        return;
      }

      process.stdout.write(
        `\r\x1b[K▶  ${formatRemaining(derived.remainingMs)} remaining`,
      );
    }, 500);
  });
}

export interface StartArgs {
  duration?: string;
  project?: string;
  "no-project"?: boolean;
  force?: boolean;
  detach?: boolean;
}

/**
 * The whole of `pmdr start`. Exported because bare `pmdr` starts a pomodoro
 * too — it routes here rather than duplicating the resolve-init-print-countdown
 * sequence, so the two can never drift.
 */
export async function runStart(args: StartArgs): Promise<void> {
  let durationMs: number;
  try {
    durationMs = resolveStartDurationMs(args.duration);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const projectsModule = createProjectsModule(STATE_DIR);
  const project = resolveStartProject(
    args.project,
    projectsModule,
    args["no-project"] ? undefined : projectsModule,
  );

  const store = createStateModule(STATE_DIR);
  const now = Date.now();

  try {
    initTimer({ store, durationMs, now, project, force: args.force === true });
    if (project !== UNASSIGNED_PROJECT) {
      projectsModule.writeLastProject(project);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  console.log(
    `Starting ${formatDurationLabel(durationMs)} pomodoro... [${project}]`,
  );

  const countdown = decideCountdown({
    detach: args.detach === true,
    stdoutIsTty: process.stdout.isTTY === true,
  });
  if (!countdown.render) {
    if (countdown.note) console.log(countdown.note);
    return;
  }

  await runCountdown(store);
}

function formatDurationLabel(durationMs: number): string {
  const mins = durationMs / 60_000;
  return durationMs >= 60_000
    ? `${Number.isInteger(mins) ? mins : mins.toFixed(1)}m`
    : `${durationMs / 1_000}s`;
}

export default defineCommand({
  meta: {
    description: "Start a 25-minute pomodoro timer",
  },
  args: {
    duration: {
      type: "string",
      description: "Custom duration (e.g. 25m, 10s)",
    },
    project: {
      type: "string",
      description: "Project to attribute this pomodoro to",
    },
    "no-project": {
      type: "boolean",
      description: "Force unassigned, bypassing the last-used-project fallback",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Replace any active timer before starting",
      default: false,
    },
    detach: {
      type: "boolean",
      description: "Start the timer without rendering the countdown",
      default: false,
    },
  },
  async run({ args }) {
    await runStart({
      duration: args.duration as string | undefined,
      project: args.project as string | undefined,
      "no-project": args["no-project"] as boolean,
      force: args.force as boolean,
      detach: args.detach as boolean,
    });
  },
});
