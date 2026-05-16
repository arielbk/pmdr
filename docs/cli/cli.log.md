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

---

## status-command — 2026-05-16

**Slice:** `status-command`
**Status:** done

**What was done:**
- Exported `getStatus({ store, now })` from `apps/cli/src/commands/status.ts` that: calls `store.finalizeIfExpired(now)` (lazy-completion path), derives state, and returns a typed `StatusResult` — either `{ state: "idle" }` or `{ state: "running"|"paused", remainingMs, duration, startedAt }`.
- Exported `formatStatus(result)` that formats idle as `"idle"` and running/paused as `"running — mm:ss left"` / `"paused — mm:ss left"`.
- Wired the citty command: reads the prod state module, calls `getStatus`, and outputs either `JSON.stringify(result)` (`--json` flag) or `formatStatus(result)`.
- The `--json` output shape matches the spec: `{ state, remainingMs, duration, startedAt }` (or `{ state: "idle" }`).
- Created `apps/cli/src/__tests__/status.test.ts` with 11 tests covering: idle (no file), running, paused, expired → idle (lazy finalization), completion appended on lazy-finalize, accumulated-pause math, and all `formatStatus` cases (idle, running, paused, 0s, seconds padding).

**Feedback loop result:**
- `vitest run` → 48/48 tests pass (19 state + 18 start + 11 status) ✓
- `tsc --noEmit` → no type errors ✓
- `tsup build` → compiles cleanly ✓

---

## pause-resume-stop — 2026-05-16

**Slice:** `pause-resume-stop`
**Status:** done

**What was done:**
- Rewrote `apps/cli/src/commands/pause.ts`: exported `pauseTimer({ store, now })` that calls `finalizeIfExpired` (lazy completion), then errors if idle or already-paused, otherwise sets `pausedAt = now` and writes state. The citty command prints "Paused." or exits 1 with error message.
- Rewrote `apps/cli/src/commands/resume.ts`: exported `resumeTimer({ store, now })` that calls `finalizeIfExpired`, then errors if idle or already-running, otherwise computes `pauseDurationMs = now - pausedAt`, adds it to `accumulatedPauseMs`, clears `pausedAt`, and writes state. The citty command prints "Resumed." or exits 1.
- Rewrote `apps/cli/src/commands/stop.ts`: exported `stopTimer({ store })` (no `now` needed) that reads state and, if present, calls `clearState()` (no completion logged) and returns `true`; returns `false` on idle. The citty command prints "Stopped." only when a timer was actually stopped.
- Created `apps/cli/src/__tests__/pause-resume-stop.test.ts` with 15 tests covering: all error paths (idle/already-paused for pause; idle/already-running for resume), correct state mutations (pausedAt set, accumulated pause math, second resume stacking), expired-timer lazy-finalization for pause and resume, and stop's no-log guarantee for both running and paused timers.

**Feedback loop result:**
- `vitest run` → 63/63 tests pass (19 state + 11 status + 18 start + 15 pause-resume-stop) ✓
- `tsc --noEmit` → no type errors ✓
- `tsup build` → compiles cleanly ✓

---

## today-command — 2026-05-16

**Slice:** `today-command`
**Status:** done

**What was done:**
- Added `readCompletions()` to `createStateModule` in `apps/cli/src/state.ts`: reads `completions.jsonl`, returns `CompletionRecord[]` (returns `[]` if file absent).
- Rewrote `apps/cli/src/commands/today.ts` with:
  - Exported `filterToday(completions, now)` — pure filter using local-date boundary (year/month/day comparison on `new Date(completedAt)` vs `new Date(now)`).
  - Exported `getToday({ store, now })` that calls `store.finalizeIfExpired(now)` (lazy-completion path), reads all completions, filters to today, returns `{ count, completions }`.
  - Exported `formatToday(result)` that prints `N pomodoro(s) today` with an indented HH:MM timestamp line per completion. Hours are unpadded; minutes are zero-padded.
  - The citty command prints JSON (`JSON.stringify(result)`) on `--json`, otherwise `formatToday(result)`.
- Created `apps/cli/src/__tests__/today.test.ts` with 15 tests covering: `filterToday` (empty input, same-date inclusion, previous-date exclusion, future-date exclusion, mixed boundary list), `formatToday` (zero count, singular/plural label, multi-line indented list, minute padding), and `getToday` (no completions file, all-today completions, yesterday exclusion, expired-timer finalization, JSON shape).

**Feedback loop result:**
- `vitest run` → 78/78 tests pass (19 state + 18 start + 11 status + 15 pause-resume-stop + 15 today) ✓
- `tsc --noEmit` → no type errors ✓
- `tsup build` → compiles cleanly ✓
