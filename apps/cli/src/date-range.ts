/**
 * Pure date-range resolution: turning `YYYY-MM-DD` strings into local-time
 * millisecond windows. No I/O — everything here is testable without a state dir.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local-midnight timestamp that opens the calendar day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The last millisecond of the calendar day containing `ms`. */
export function endOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
}

/** `YYYY-MM-DD` for the local calendar day containing `ms`. */
export function toLocalDateKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Parse `YYYY-MM-DD` into local midnight, or null when malformed. */
export function parseLocalDate(input: string): number | null {
  const match = DATE_RE.exec(input);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(year, month - 1, day);
  // Reject values that roll over (e.g. 2026-02-31 → March).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d.getTime();
}

export interface DateWindow {
  /** Resolved inclusive start date, `YYYY-MM-DD`. */
  from: string;
  /** Resolved inclusive end date, `YYYY-MM-DD`. */
  to: string;
  startMs: number;
  endMs: number;
}

/**
 * Resolve a `from`/`to` pair into an inclusive local-time window spanning
 * midnight on `from` through the last millisecond of `to`.
 *
 * An omitted endpoint is unbounded, with no exceptions: no `to` runs through
 * today, and no `from` runs from the earliest record on file. The window is
 * echoed back as resolved `from`/`to` keys so a caller can restate the range it
 * actually got.
 */
export function resolveRange(opts: {
  from?: string;
  to?: string;
  now: number;
  earliest?: number | null;
}): DateWindow {
  const to = opts.to ?? toLocalDateKey(opts.now);
  // With nothing on file the history is empty, so an unbounded start collapses
  // onto today rather than reaching back to an arbitrary epoch.
  const from = opts.from ?? toLocalDateKey(opts.earliest ?? opts.now);
  const startMs = parseLocalDate(from);
  const endDay = parseLocalDate(to);
  if (startMs === null || endDay === null) {
    throw new Error("invalid date");
  }
  return {
    from,
    to,
    startMs,
    endMs: endOfLocalDay(endDay),
  };
}
