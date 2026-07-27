import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const CLI_DIST = join(REPO_ROOT, "apps/cli/dist/index.js");
const LOCK_DIR = join(tmpdir(), "pmdr-test-cli-build.lock");
const LOCK_TIMEOUT_MS = 120_000;

/**
 * Builds `dist/index.js` once, and hands back its path.
 *
 * The integration tests spawn the real binary, so each of them needs a built
 * CLI — but they run in parallel workers, and `tsup` is configured with
 * `clean: true`. Two files calling `pnpm build` at once means one of them
 * deletes `dist` from under the other's `pmdr` symlink, and every spawn in that
 * file comes back with a null status. So the build is taken under a lock
 * directory (atomic `mkdir`), and whoever loses the race waits for the winner
 * rather than starting a second, destructive build.
 */
export function ensureCliBuilt(): string {
  if (acquireLock()) {
    try {
      execFileSync("pnpm", ["--filter", "@arielbk/pmdr", "build"], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
    } finally {
      releaseLock();
    }
  } else {
    waitForBuild();
  }

  if (!existsSync(CLI_DIST)) {
    throw new Error(`build produced no CLI entrypoint at ${CLI_DIST}`);
  }
  return CLI_DIST;
}

function acquireLock(): boolean {
  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch {
    // A stale lock — left behind by a killed run — must not wedge the suite.
    if (lockAgeMs() > LOCK_TIMEOUT_MS) {
      releaseLock();
      return acquireLock();
    }
    return false;
  }
}

function releaseLock(): void {
  try {
    rmdirSync(LOCK_DIR);
  } catch {
    // Already gone.
  }
}

function lockAgeMs(): number {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs;
  } catch {
    return 0;
  }
}

/** Blocks until the holder of the lock has finished its build. */
function waitForBuild(): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (existsSync(LOCK_DIR) && Date.now() < deadline) {
    sleepSync(50);
  }
}

/** A blocking sleep, so callers can stay synchronous inside `beforeAll`. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
