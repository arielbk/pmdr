import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDuration } from "../parse-duration.js";
import { createStateModule, deriveState } from "../state.js";
import { createProjectsModule } from "../projects.js";

const DEFAULT_DURATION_MS = 25 * 60 * 1_000;
const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export function initTimer(options: {
  store: ReturnType<typeof createStateModule>;
  durationMs: number;
  now: number;
  project: string;
}): void {
  const { store, durationMs, now, project } = options;

  store.finalizeIfExpired(now);

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
  });
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
        store.finalizeIfExpired(now);
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
      : "(unassigned)";

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
