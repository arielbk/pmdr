import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule, deriveState } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export function resumeTimer(opts: {
  store: ReturnType<typeof createStateModule>;
  now: number;
}): void {
  const { store, now } = opts;

  store.advancePhaseIfExpired(now);

  const file = store.readState();
  const derived = deriveState({ file, now });

  if (derived.kind === "idle") {
    throw new Error("No timer is running.");
  }
  if (derived.kind === "running") {
    throw new Error("Timer is already running.");
  }

  const pauseDurationMs = now - file!.pausedAt!;
  store.writeState({
    ...file!,
    pausedAt: null,
    accumulatedPauseMs: file!.accumulatedPauseMs + pauseDurationMs,
  });
}

export default defineCommand({
  meta: {
    description: "Resume a paused timer",
  },
  run() {
    const store = createStateModule(STATE_DIR);
    const now = Date.now();
    try {
      resumeTimer({ store, now });
      console.log("Resumed.");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  },
});
