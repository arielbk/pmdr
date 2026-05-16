import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import type { CompletionRecord } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export interface TodayResult {
  count: number;
  completions: CompletionRecord[];
}

export function filterToday(
  completions: CompletionRecord[],
  now: number,
): CompletionRecord[] {
  const nowD = new Date(now);
  return completions.filter((c) => {
    const d = new Date(c.completedAt);
    return (
      d.getFullYear() === nowD.getFullYear() &&
      d.getMonth() === nowD.getMonth() &&
      d.getDate() === nowD.getDate()
    );
  });
}

export function getToday(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
}): TodayResult {
  const { store, now } = opts;
  store.finalizeIfExpired(now);
  const all = store.readCompletions();
  const completions = filterToday(all, now);
  return { count: completions.length, completions };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatToday(result: TodayResult): string {
  const label = result.count === 1 ? "pomodoro" : "pomodoros";
  const header = `${result.count} ${label} today`;
  if (result.completions.length === 0) return header;
  const lines = result.completions.map((c) => `  ${formatTime(c.completedAt)}`);
  return [header, ...lines].join("\n");
}

export default defineCommand({
  meta: {
    description: "Show today's completed pomodoros",
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
    const result = getToday({ store, now });

    if (args.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatToday(result));
    }
  },
});
