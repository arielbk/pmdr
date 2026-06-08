import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule, deriveState } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export function pauseTimer(opts: {
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
  if (derived.kind === "paused") {
    throw new Error("Timer is already paused.");
  }

  // Pausing a running break stops it (clears to idle) instead of pausing it.
  if (file!.phase === "break") {
    store.clearState();
    if (file!.id) {
      store.appendEvent({
        type: "stop",
        at: now,
        id: file!.id,
        ...(file!.project !== undefined ? { project: file!.project } : {}),
      });
    }
    return;
  }

  store.writeState({ ...file!, pausedAt: now });
  if (file!.id) {
    store.appendEvent({
      type: "pause",
      at: now,
      id: file!.id,
      ...(file!.project !== undefined ? { project: file!.project } : {}),
    });
  }
}

export default defineCommand({
  meta: {
    description: "Pause the running timer",
  },
  run() {
    const store = createStateModule(STATE_DIR);
    const now = Date.now();
    try {
      pauseTimer({ store, now });
      console.log("Paused.");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  },
});
