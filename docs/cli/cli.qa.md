# QA Plan — pmdr CLI

**Feature:** `cli`
**Date:** 2026-05-16
**Slices:** scaffold, state-module, start-command, status-command, pause-resume-stop, today-command

---

## Already verified by the agent

### scaffold

- [x] `pnpm --filter cli build && pnpm --filter cli exec pmdr --help` — prints all 6 commands with descriptions
- [x] `pmdr --version` — prints `0.1.0`

### state-module

- [x] `vitest run` — 19/19 tests pass (deriveState table, pause math, round-trip, atomic write, finalizeIfExpired)
- [x] `tsc --noEmit` — no type errors
- [x] `tsup build` — compiles cleanly

### start-command

- [x] `vitest run` — 37/37 tests pass (19 state + 18 start; parseDuration formats, initTimer guards, expired-before-start)
- [x] `tsc --noEmit` — no type errors
- [x] `tsup build` — compiles cleanly
- [x] `pmdr start --duration 2s` — countdown renders, terminal bell fires, exits, entry written to `completions.jsonl`
- [x] Starting a second timer while one is running — prints "A pomodoro is already running." and exits 1

### status-command

- [x] `vitest run` — 48/48 tests pass (19 state + 18 start + 11 status; idle, running, paused, lazy-finalize, accumulated-pause math, formatStatus)
- [x] `tsc --noEmit` — no type errors
- [x] `tsup build` — compiles cleanly

### pause-resume-stop

- [x] `vitest run` — 63/63 tests pass (19 state + 18 start + 11 status + 15 pause-resume-stop; all error paths, state mutations, stacked-pause math, stop no-log guarantee)
- [x] `tsc --noEmit` — no type errors
- [x] `tsup build` — compiles cleanly

### today-command

- [x] `vitest run` — 78/78 tests pass (19 state + 18 start + 11 status + 15 pause-resume-stop + 15 today; filterToday boundary cases, formatToday output, getToday lazy-finalize)
- [x] `tsc --noEmit` — no type errors
- [x] `tsup build` — compiles cleanly

---

## Human verification required

### start-command — live countdown in two terminals

- [ ] Open T1 and run `pmdr start --duration 10s`. Confirm countdown ticks visually and the display updates ~every second.
- [ ] While T1 is running, open T2 and inspect `~/.local/state/pmdr/state.json`. Confirm it contains a well-formed record with `startedAt`, `durationMs`, `accumulatedPauseMs`.
- [ ] Close T1 mid-run (Ctrl-C). Confirm `~/.local/state/pmdr/state.json` is still present on disk (state survives abrupt exit).

### status-command — live two-terminal check

- [ ] Start a timer in T1. In T2, run `pmdr status` — confirm output is `running — MM:SS left` with a plausible remaining time.
- [ ] In T2, run `pmdr status --json` — confirm JSON shape `{ state, remainingMs, duration, startedAt }` with correct values.
- [ ] Let the timer expire (or write a fake expired state file). Run `pmdr status` in T2 — confirm it prints `idle` AND a new entry appears in `completions.jsonl` (lazy-completion path exercised end-to-end).

### pause-resume-stop — live two-terminal check

- [ ] Start a timer in T1. In T2, run `pmdr pause`. Confirm the countdown in T1 freezes within ~1 second and T2 prints "Paused."
- [ ] In T2, run `pmdr resume`. Confirm the countdown in T1 resumes from the same value and T2 prints "Resumed."
- [ ] Confirm `pmdr pause` while already paused exits 1 with an error message.
- [ ] Confirm `pmdr resume` while running exits 1 with an error message.
- [ ] In T2, run `pmdr stop`. Confirm T1's renderer exits cleanly and T2 prints "Stopped."
- [ ] After stopping, run `pmdr today` — confirm the stopped pomodoro does NOT appear in the list.
- [ ] Run `pmdr stop` with no timer running — confirm it is a no-op (no error, no output or silent exit 0).

### today-command — local-date boundary

- [ ] Append completion entries to `~/.local/state/pmdr/completions.jsonl` spanning the local-midnight boundary (yesterday, today, tomorrow). Run `pmdr today` — confirm only today's entries are counted using local date (not UTC).
- [ ] Run `pmdr today --json` — confirm shape is `{ count, completions: [{ completedAt, durationMs }, ...] }` with only today's entries.
- [ ] Run `pmdr today` with zero completions — confirm output is `0 pomodoros today` with no list lines.
- [ ] Run `pmdr today` with multiple completions — confirm singular/plural label and that each line shows an `H:MM` timestamp (hours unpadded, minutes zero-padded).

---

## Watch closely

No deviations were recorded in any iteration log. All slices completed on the same day (2026-05-16) without noted regressions or workarounds.

One structural note: the `status-command` and `pause-resume-stop` two-terminal scenarios specified in the slice feedback loops were not exercised manually by the agent (only unit tests ran for those slices). The human-verification items above cover those gaps.
