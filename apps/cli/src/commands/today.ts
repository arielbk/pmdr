import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import type { CompletionRecord } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

// ─── Legacy flat API (preserved for backward compatibility) ───────────────────

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

// ─── Grouped API ──────────────────────────────────────────────────────────────

export interface TodayGroup {
  project: string;
  pomodoros: number;
  totalMs: number;
  entries: CompletionRecord[];
}

export interface TodayGroupedResult {
  groups: TodayGroup[];
  total: { pomodoros: number; totalMs: number };
}

export function getTodayGrouped(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
  project?: string;
}): TodayGroupedResult {
  const { store, now, project } = opts;
  const grouped = store.readToday(now);

  let entries = Object.entries(grouped);
  if (project !== undefined) {
    entries = entries.filter(([key]) => key === project);
  }

  const groups: TodayGroup[] = entries.map(([proj, records]) => ({
    project: proj,
    pomodoros: records.length,
    totalMs: records.reduce((sum, e) => sum + e.durationMs, 0),
    entries: records,
  }));

  const total = {
    pomodoros: groups.reduce((sum, g) => sum + g.pomodoros, 0),
    totalMs: groups.reduce((sum, g) => sum + g.totalMs, 0),
  };

  return { groups, total };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatMs(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  return `${totalMin}m`;
}

export function formatTodayGrouped(result: TodayGroupedResult): string {
  const lines: string[] = [];

  for (const group of result.groups) {
    const label = group.pomodoros === 1 ? "pomodoro" : "pomodoros";
    lines.push(`${group.project}: ${group.pomodoros} ${label}, ${formatMs(group.totalMs)}`);
    for (const entry of group.entries) {
      lines.push(`  ${formatTime(entry.completedAt)}`);
    }
  }

  const totalLabel = result.total.pomodoros === 1 ? "pomodoro" : "pomodoros";
  lines.push(`Total: ${result.total.pomodoros} ${totalLabel}, ${formatMs(result.total.totalMs)}`);

  return lines.join("\n");
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
    project: {
      type: "string",
      description: "Filter to a single project",
    },
  },
  run({ args }) {
    const store = createStateModule(STATE_DIR);
    const now = Date.now();
    const result = getTodayGrouped({ store, now, project: args.project });

    if (args.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatTodayGrouped(result));
    }
  },
});
