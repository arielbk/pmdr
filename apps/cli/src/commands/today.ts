import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import { toLocalDateKey } from "../date-range.js";
import { buildLog, formatLog, type LogResult } from "./log.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

/**
 * `today` is an alias for `log` over the single local day containing `now` —
 * it delegates rather than re-implementing, so the two can never drift.
 */
export function buildToday(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
  project?: string;
}): LogResult {
  const date = toLocalDateKey(opts.now);
  return buildLog({ ...opts, from: date, to: date });
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
    const result = buildToday({ store, now: Date.now(), project: args.project });

    if (args.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatLog(result));
    }
  },
});
