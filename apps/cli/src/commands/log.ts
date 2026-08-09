import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import type { CompletionRecord, NoteRecord } from "../state.js";
import { resolveRange, toLocalDateKey } from "../date-range.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export interface LogGroup {
  project: string;
  pomodoros: number;
  totalMs: number;
  entries: CompletionRecord[];
}

export interface LogTotal {
  pomodoros: number;
  totalMs: number;
}

export interface LogDay {
  date: string;
  groups: LogGroup[];
  total: LogTotal;
  notes: NoteRecord[];
}

export interface LogResult {
  from: string;
  to: string;
  days: LogDay[];
  total: LogTotal;
}

/**
 * Select completions and notes inside an inclusive local date range and return
 * them grouped by day, then by project.
 *
 * Settling an expired timer before the read is part of the contract: this used
 * to live in `state.readToday`, and moving the grouping out of the state layer
 * must not lose it.
 */
export function buildLog(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
  from?: string;
  to?: string;
  project?: string;
}): LogResult {
  const { store, now, project } = opts;
  store.advancePhaseIfExpired(now);

  const allCompletions = store.readCompletions();
  const allNotes = store.readNotes();
  const stamps = [...allCompletions.map((c) => c.completedAt), ...allNotes.map((n) => n.at)];
  const earliest = stamps.length > 0 ? Math.min(...stamps) : null;

  const window = resolveRange({ from: opts.from, to: opts.to, now, earliest });
  const inWindow = (at: number) => at >= window.startMs && at <= window.endMs;

  const completions = allCompletions
    .filter((c) => inWindow(c.completedAt))
    .filter((c) => project === undefined || (c.project ?? "(unassigned)") === project);
  const notes = allNotes.filter((n) => inWindow(n.at)).sort((a, b) => a.at - b.at);

  const dates = new Set<string>();
  for (const c of completions) dates.add(toLocalDateKey(c.completedAt));
  for (const n of notes) dates.add(toLocalDateKey(n.at));

  const days: LogDay[] = [...dates]
    .sort()
    .map((date) => {
      const dayEntries = completions.filter((c) => toLocalDateKey(c.completedAt) === date);
      const byProject = new Map<string, CompletionRecord[]>();
      for (const entry of dayEntries) {
        const key = entry.project ?? "(unassigned)";
        const bucket = byProject.get(key);
        if (bucket) bucket.push(entry);
        else byProject.set(key, [entry]);
      }
      const groups: LogGroup[] = [...byProject].map(([proj, entries]) => ({
        project: proj,
        pomodoros: entries.length,
        totalMs: entries.reduce((sum, e) => sum + e.durationMs, 0),
        entries,
      }));
      return {
        date,
        groups,
        total: {
          pomodoros: groups.reduce((sum, g) => sum + g.pomodoros, 0),
          totalMs: groups.reduce((sum, g) => sum + g.totalMs, 0),
        },
        notes: notes.filter((n) => toLocalDateKey(n.at) === date),
      };
    });

  return {
    from: window.from,
    to: window.to,
    days,
    total: {
      pomodoros: days.reduce((sum, d) => sum + d.total.pomodoros, 0),
      totalMs: days.reduce((sum, d) => sum + d.total.totalMs, 0),
    },
  };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMs(ms: number): string {
  return `${Math.round(ms / 60_000)}m`;
}

export function formatLog(result: LogResult): string {
  // An empty result must read as an empty result, not as a blank line or a bare
  // zero total — the range is restated so a reader can see what was asked for.
  if (result.days.length === 0) {
    return `Nothing recorded from ${result.from} to ${result.to}`;
  }

  const lines: string[] = [];

  for (const day of result.days) {
    if (lines.length > 0) lines.push("");
    lines.push(day.date);
    for (const group of day.groups) {
      const label = group.pomodoros === 1 ? "pomodoro" : "pomodoros";
      lines.push(`  ${group.project}: ${group.pomodoros} ${label}, ${formatMs(group.totalMs)}`);
      for (const entry of group.entries) {
        lines.push(`    ${formatTime(entry.completedAt)}`);
      }
    }
    if (day.notes.length > 0) {
      lines.push("  Notes:");
      for (const n of day.notes) {
        lines.push(`    ${formatTime(n.at)}  ${n.text}`);
      }
    }
  }

  // A single-day range already shows its own per-day figures, so a grand total
  // would just restate them.
  if (result.from !== result.to) {
    if (lines.length > 0) lines.push("");
    const label = result.total.pomodoros === 1 ? "pomodoro" : "pomodoros";
    lines.push(`Total: ${result.total.pomodoros} ${label}, ${formatMs(result.total.totalMs)}`);
  }

  return lines.join("\n");
}

export default defineCommand({
  meta: {
    description: "Show completed pomodoros and notes over a date range",
  },
  args: {
    from: {
      type: "string",
      description: "Inclusive start date, YYYY-MM-DD",
    },
    to: {
      type: "string",
      description: "Inclusive end date, YYYY-MM-DD",
    },
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
    let result: LogResult;
    try {
      result = buildLog({
        store,
        now: Date.now(),
        // An omitted endpoint is unbounded, so leave it undefined for the resolver
        // rather than substituting a default here.
        from: args.from || undefined,
        to: args.to || undefined,
        project: args.project,
      });
    } catch (e) {
      // A bad range must be distinguishable from an empty one: explain on
      // stderr, leave stdout untouched, exit non-zero.
      console.error((e as Error).message);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatLog(result));
    }
  },
});
