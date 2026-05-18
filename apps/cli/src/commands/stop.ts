import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";

const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

export function stopTimer(opts: {
  store: ReturnType<typeof createStateModule>;
  now?: number;
}): boolean {
  const { store } = opts;
  const file = store.readState();
  if (!file) return false;
  store.clearState();
  if (file.id) {
    store.appendEvent({
      type: "stop",
      at: opts.now ?? Date.now(),
      id: file.id,
      ...(file.project !== undefined ? { project: file.project } : {}),
    });
  }
  return true;
}

export default defineCommand({
  meta: {
    description: "Stop the current timer",
  },
  run() {
    const store = createStateModule(STATE_DIR);
    const stopped = stopTimer({ store, now: Date.now() });
    if (stopped) {
      console.log("Stopped.");
    }
  },
});
