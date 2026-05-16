# CLI Implementation Log

---

## scaffold — 2026-05-16

**Slice:** `scaffold`
**Status:** done

**What was done:**
- Created `apps/cli/` package with citty as the CLI framework and tsup as the bundler.
- Defined all six subcommands (`start`, `pause`, `resume`, `stop`, `status`, `today`) as stub command files under `src/commands/`.
- Wired the main entry `src/index.ts` using `defineCommand` + `runMain` from citty, reading the version from `package.json`.
- Added `tsup.config.ts` with shebang banner (`#!/usr/bin/env node`) and ESM format.
- Added `"cli": "workspace:*"` to root `package.json` devDependencies so pnpm links the `pmdr` binary in `node_modules/.bin`.

**Feedback loop result:**
- `pnpm --filter cli build && pnpm --filter cli exec pmdr --help` — prints all 6 commands with descriptions ✓
- `pmdr --version` — prints `0.1.0` ✓

---

## state-module — 2026-05-16

**Slice:** `state-module`
**Status:** done

**What was done:**
- Created `apps/cli/src/state.ts` exporting: `deriveState` (pure), `createStateModule(dir)` factory, and top-level named exports (`readState`, `writeState`, `clearState`, `appendCompletion`, `finalizeIfExpired`) bound to the XDG-compliant default path `~/.local/state/pmdr/`.
- `writeState` uses a temp-file + `renameSync` for atomic writes, preventing partial-read corruption.
- `finalizeIfExpired` is idempotent: on an already-idle state it returns immediately; on an expired state it appends one `completions.jsonl` line and clears the state file.
- Added `vitest@^2.0.0` to devDependencies and `"test": "vitest run"` script.
- Created `apps/cli/vitest.config.ts` (minimal node environment config).
- Created `apps/cli/src/__tests__/state.test.ts` with 19 tests covering: `deriveState` table (idle/running/paused/expired/boundary), pause math, round-trip read/write, directory auto-creation, atomic write, clearState idempotency, appendCompletion, and all `finalizeIfExpired` cases.

**Feedback loop result:**
- `vitest run` → 19/19 tests pass ✓
- `tsc --noEmit` → no type errors ✓
- `tsup build` → compiles cleanly ✓

---

## start-command — 2026-05-16

**Slice:** `start-command`
**Status:** done

**What was done:**
- Created `apps/cli/src/parse-duration.ts` exporting `parseDuration(s)` which parses duration strings like `25m`, `90s`, `1h`, `500ms` into milliseconds.
- Rewrote `apps/cli/src/commands/start.ts` with:
  - Exported `initTimer({ store, durationMs, now })` that calls `finalizeIfExpired` (lazy completion), checks for running/paused guards, then writes the new state record.
  - `runCountdown(store)` that polls the state file every 500ms via `setInterval`, handles paused display, expired completion (with terminal bell), and external stop (state file cleared).
  - The citty command wires `parseDuration`, `initTimer`, and `runCountdown` together with the prod state dir.
- Created `apps/cli/src/__tests__/start.test.ts` with 18 tests covering: all `parseDuration` valid formats, invalid format errors, `initTimer` idle→write, running guard, paused guard, and expired-before-start finalization.

**Feedback loop result:**
- `vitest run` → 37/37 tests pass (19 state + 18 start) ✓
- `tsc --noEmit` → no type errors ✓
- `tsup build` → compiles cleanly ✓
- Manual: `pmdr start --duration 2s` shows countdown, fires bell, exits, logs to `completions.jsonl` ✓
- Manual: starting a second timer while one is running prints "A pomodoro is already running." and exits 1 ✓
