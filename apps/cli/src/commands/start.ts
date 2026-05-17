import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDuration } from "../parse-duration.js";
import { createStateModule, deriveState } from "../state.js";
import { createProjectsModule } from "../projects.js";
import { select, text, cancel, isCancel } from "@clack/prompts";

const DEFAULT_DURATION_MS = 25 * 60 * 1_000;
const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export function initTimer(options: {
  store: ReturnType<typeof createStateModule>;
  durationMs: number;
  now: number;
  project: string;
}): void {
  const { store, durationMs, now, project } = options;

  store.advancePhaseIfExpired(now);

  const file = store.readState();
  const derived = deriveState({ file, now });

  if (derived.kind === "running") {
    throw new Error("A pomodoro is already running.");
  }
  if (derived.kind === "paused") {
    throw new Error("A pomodoro is paused. Resume or stop it first.");
  }

  store.writeState({
    startedAt: now,
    durationMs,
    pausedAt: null,
    accumulatedPauseMs: 0,
    project,
    phase: "focus",
    completedFocusBlocks: 0,
  });
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

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function runCountdown(
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
        process.stdout.write("Pomodoro complete!\x07\n");
        resolve();
        return;
      }

      process.stdout.write(
        `\r\x1b[K▶  ${formatRemaining(derived.remainingMs)} remaining`,
      );
    }, 500);
  });
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
    "no-interactive": {
      type: "boolean",
      description: "Force non-interactive mode (error if no --project)",
      default: false,
    },
  },
  async run({ args }) {
    let durationMs: number;
    try {
      durationMs = args.duration
        ? parseDuration(args.duration)
        : DEFAULT_DURATION_MS;
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const projectArg = args.project as string | undefined;
    const noInteractive = args["no-interactive"] as boolean;

    if (!projectArg && (!process.stdout.isTTY || noInteractive)) {
      console.error("no --project specified and stdout is not a TTY");
      process.exit(1);
    }

    const projects = createProjectsModule(STATE_DIR);
    const project = projectArg
      ? projects.upsertProject(projectArg).name
      : await pickProject({ projects });

    const store = createStateModule(STATE_DIR);
    const now = Date.now();

    try {
      initTimer({ store, durationMs, now, project });
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const mins = durationMs / 60_000;
    const label =
      durationMs >= 60_000
        ? `${Number.isInteger(mins) ? mins : mins.toFixed(1)}m`
        : `${durationMs / 1_000}s`;
    console.log(`Starting ${label} pomodoro... [${project}]`);

    await runCountdown(store);
  },
});
