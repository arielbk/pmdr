import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule, deriveState } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export type StatusResult =
  | { state: "idle" }
  | {
      state: "running" | "paused";
      remainingMs: number;
      duration: number;
      startedAt: number;
    };

export function getStatus(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
}): StatusResult {
  const { store, now } = opts;

  store.finalizeIfExpired(now);

  const file = store.readState();
  const derived = deriveState({ file, now });

  if (derived.kind === "idle" || derived.kind === "expired") {
    return { state: "idle" };
  }

  return {
    state: derived.kind,
    remainingMs: derived.remainingMs,
    duration: file!.durationMs,
    startedAt: file!.startedAt,
  };
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatStatus(result: StatusResult): string {
  if (result.state === "idle") return "idle";
  return `${result.state} — ${formatRemaining(result.remainingMs)} left`;
}

export default defineCommand({
  meta: {
    description: "Show current timer status",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run({ args }) {
    const store = createStateModule(STATE_DIR);
    const now = Date.now();
    const result = getStatus({ store, now });

    if (args.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatStatus(result));
    }
  },
});
