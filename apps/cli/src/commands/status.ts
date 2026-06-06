import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule, deriveState } from "../state.js";
import { createConfigModule } from "../config.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export type StatusResult =
  | { state: "idle" }
  | {
      state: "running" | "paused";
      remainingMs: number;
      duration: number;
      startedAt: number;
      phase: "focus" | "break";
      completedFocusBlocks: number;
      todayFocusBlocks: number;
      longBreakEvery: number;
      project?: string;
    };

export function getStatus(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
  config?: Pick<ReturnType<typeof createConfigModule>, "readEffectiveConfig">;
}): StatusResult {
  const { store, now } = opts;
  const config = opts.config ?? createConfigModule();

  store.advancePhaseIfExpired(now);

  const file = store.readState();
  const derived = deriveState({ file, now });

  if (derived.kind === "idle" || derived.kind === "expired") {
    return { state: "idle" };
  }

  const todayFocusBlocks = store.countTodayFocusBlocks(now);
  const { longBreakEvery } = config.readEffectiveConfig();

  const base = {
    state: derived.kind,
    remainingMs: derived.remainingMs,
    duration: file!.durationMs,
    startedAt: file!.startedAt,
    phase: file!.phase ?? "focus",
    completedFocusBlocks: file!.completedFocusBlocks ?? 0,
    todayFocusBlocks,
    longBreakEvery,
  } as const;

  return file!.project ? { ...base, project: file!.project } : base;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatStatus(result: StatusResult): string {
  if (result.state === "idle") return "idle";
  const remaining = formatRemaining(result.remainingMs);
  const prefix =
    result.state === "paused" ? `${result.phase} paused` : result.phase;
  const { longBreakEvery, todayFocusBlocks } = result;
  const suffix =
    result.phase === "focus"
      ? `(block ${(todayFocusBlocks % longBreakEvery) + 1}/${longBreakEvery})`
      : `(${todayFocusBlocks}/${longBreakEvery} done)`;
  return `${prefix} — ${remaining} left ${suffix}`;
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
