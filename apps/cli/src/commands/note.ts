import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

/**
 * Capture a timestamped note, stamped with the live session's id / project /
 * phase. Whitespace-only (or empty) text is a no-op that writes nothing.
 * Returns true when a record was appended, false otherwise.
 */
export function addNote(opts: {
  store: ReturnType<typeof createStateModule>;
  text: string;
  now: number;
}): boolean {
  const { store, now } = opts;
  const trimmed = opts.text.trim();
  if (!trimmed) return false;

  // Advance first so the stamp reflects the real current phase: an expired
  // focus has already rolled into its pending break, an expired break to idle.
  store.advancePhaseIfExpired(now);
  const file = store.readState();

  store.appendNote({
    text: trimmed,
    at: now,
    sessionId: file?.id ?? "",
    project: file?.project ?? "",
    phase: file?.phase ?? "",
  });
  return true;
}

export default defineCommand({
  meta: {
    description: "Capture a timestamped note stamped with the current session",
  },
  args: {
    text: {
      type: "positional",
      description: "Note text (quote multi-word notes)",
      required: false,
    },
  },
  run({ args }) {
    const store = createStateModule(STATE_DIR);
    const text = (args.text as string | undefined) ?? "";
    const wrote = addNote({ store, text, now: Date.now() });
    if (wrote) {
      console.log("Noted.");
    }
  },
});
