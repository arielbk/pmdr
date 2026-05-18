# Event Log Feature — Implementation Log

---

## late-project-attribution — 2026-05-18

**Slice:** `late-project-attribution` — Late-binding project attribution

**Status:** done

**What was implemented:**
- `initTimer` now accepts an omitted project and writes the active state record with `project: "(unassigned)"`.
- `pmdr start` resolves a missing `--project` to `"(unassigned)"` instead of invoking the Clack project picker, while explicit projects still go through `upsertProject` for canonical casing.
- Completion attribution remains late-bound: expiry reads the project from the current state record, so a project changed after start is what lands in `completions.jsonl`.

**Tests:**
- Added `initTimer` coverage for the `(unassigned)` default.
- Added `resolveStartProject` coverage proving missing project does not touch the project store and explicit project names are canonicalized.
- Added completion coverage for start as `(unassigned)`, mutate active state project, then expire with the new project.

**Feedback loop result:**
- `pnpm --filter cli test -- src/__tests__/start.test.ts src/__tests__/start-with-project.test.ts` — 30/30 tests pass.
- `pnpm --filter cli check-types` — no errors.
- `pnpm --filter cli lint` — blocked by existing ESLint 9 config issue: `eslint src` cannot find an `eslint.config.(js|mjs|cjs)` file.
- `pnpm --filter cli test` — unrelated existing ANSI color expectation failures in Ink rendering tests; the slice-local tests pass.

**Notes:** The older `pickProject` helper remains for existing tests/possible future use, but `start` no longer calls it for missing `--project`.

---

## pomodoro-id — 2026-05-18

**Slice:** `pomodoro-id` — Per-timer uuid

**Status:** done

**What was implemented:**
- `StateRecord` and `CompletionRecord` gained an optional `id` field.
- `initTimer` now generates a `randomUUID()` at start (overrideable via an `id` option used by tests).
- `advancePhaseIfExpired` and `finalizeIfExpired` propagate the id onto the appended `completions.jsonl` row, and `advancePhaseIfExpired` carries the id through the focus→break state transition so the whole timer keeps one identity.

**Tests:**
- New `pomodoro-id.test.ts` covers: uuid shape at start, fresh ids per timer, completion row's id matches state's id, phase transition preserves id, and legacy state without id does not throw on read.
- Updated `start.test.ts` to pass an explicit `id` where the strict `toEqual` shape assertions live.

**Feedback loop result:**
- `pnpm --filter cli test` — 248/248 pass.
- `pnpm --filter cli check-types` — clean.

---

## event-log-emission — 2026-05-18

**Slice:** `event-log-emission` — Append-only event log

**Status:** done

**What was implemented:**
- Added `EventRecord` type and `appendEvent` / `readEvents` to the state module, writing to `~/.local/state/pmdr/events.jsonl`.
- `initTimer` writes a `start` event after persisting state.
- `pauseTimer` and `resumeTimer` emit matching `pause` / `resume` events using the active record's id.
- `stopTimer` accepts an optional `now` and emits a `stop` event only when an active record is being cleared. Expiry continues to write a `completions.jsonl` row and no `stop`.

**Tests:**
- New `event-log.test.ts` drives start → pause → resume → stop and asserts the four-row sequence with a single shared id; a second test asserts start → expiry produces a completion and no stop event; a third asserts stop on idle is a no-op.

**Feedback loop result:**
- `pnpm --filter cli test` — 251/251 pass.
- `pnpm --filter cli check-types` — clean.

---

## dots-from-completions — 2026-05-18

**Slice:** `dots-from-completions` — TUI dots fill across the day

**Status:** done

**What was implemented:**
- `derivePhaseState` now accepts an optional store and counts today's completions from `completions.jsonl` (falling back to `record.completedFocusBlocks` when no store is supplied). `App.tsx` passes its store on every derivation so the dot row reads from completions.
- `CountdownView` removed the `x/8` fraction next to the dot row; the visual remains capped at 8 dots via the existing `Math.min(..., DEFAULT_FOCUS_GOAL)`.

**Tests:**
- New `dots-from-completions.test.tsx` covers: no `/8` fraction in the rendered frame, dot count tracks `completedFocusBlocks`, cap at 8 even at higher counts, and `derivePhaseState` summing today's completions while ignoring yesterday's even after state.json has been cleared (the live focus→break→focus bug).

**Feedback loop result:**
- `pnpm --filter cli test` — 257/257 pass.
- `pnpm --filter cli check-types` — clean.
