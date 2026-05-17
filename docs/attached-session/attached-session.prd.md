# PRD: Attached Session

## Problem Statement

The interactive TUI looks like a pomodoro client but lies about state. It reads `state.json` on launch, then runs a private in-memory phase state machine that never writes back. So pausing in the TUI is invisible to `pmdr status` in another shell. The TUI auto-cycles focus → break → focus internally with no record on disk — detach and the session you thought was running is gone. `Ctrl+C` and `q` "exit" without semantics: nothing is stopped because nothing was persisted in the first place.

The mental model the user wants — and that the rest of the CLI already implies — is: there is one session, persisted to disk, and the TUI is an attached view onto it. Start and stop happen via the CLI surface (or the TUI's equivalent keys). Detaching from the TUI never ends the session.

## Solution

Treat the TUI as an attached view, not a process owning state. Extend `state.json` so it can model the full pomodoro cycle (phase + completed focus blocks), not just a single focus block. Every TUI mutation — pause, resume, stop, and focus→break auto-transitions — writes through to `state.json`. Detach keys (`Ctrl+C`, `q`, `Esc`) leave the session running. An explicit `x` key stops the session, equivalent to running `pmdr stop` from another shell. Skip is removed (it had no CLI peer and no persistence story; it was a testing affordance). Break→focus does *not* auto-advance: after a break completes, the session goes idle and the next focus block requires an explicit `pmdr start` (or `Enter` from the picker on relaunch). This preserves the "what am I working on?" beat that gives the pattern its discipline.

## User Stories

1. As a user, I want `Ctrl+C` in the TUI to detach but leave the timer running, so that closing the view doesn't accidentally end my pomodoro.
2. As a user, I want `q` and `Esc` to behave the same as `Ctrl+C` (detach), so that any "back out" instinct works.
3. As a user, I want an `x` key in the TUI that ends the session, so that I can stop from inside the view without dropping to a shell.
4. As a user, I want pausing in the TUI to be visible to `pmdr status` from another terminal, so that the CLI and the TUI never disagree about what's happening.
5. As a user, I want resuming in the TUI to persist, so that detaching mid-pause keeps the timer paused.
6. As a user, I want focus → break to transition automatically and be reflected on disk, so that detaching during focus doesn't lose the cycle.
7. As a user, I want break → focus to *not* auto-advance, so that I deliberately choose what I'm working on next.
8. As a user, I want a focus block that completes while I'm detached to still log a completion and roll into break, so that the session keeps its shape whether I'm watching or not.
9. As a user, I want the help overlay to reflect the new bindings (detach vs stop) and the removal of skip, so that the controls match the model.
10. As a user, I want `pmdr status` to report the current phase and completed focus block count, so that the persisted phase is observable from the CLI.
11. As an agent, I want existing CLI subcommands (`start`, `pause`, `resume`, `stop`, `status`, `today`, `project`) to keep their byte-identical output for the happy paths they already cover, so that my scripts don't break.

## Implementation Decisions

**State schema (`state.ts`).** Extend `StateRecord` with `phase: "focus" | "break"` and `completedFocusBlocks: number`. Old records lacking these fields are read as `phase: "focus"`, `completedFocusBlocks: 0` (forward-compatible default; no migration script needed).

**Phase advancement on read.** `finalizeIfExpired` becomes `advancePhaseIfExpired`. Behavior:

- If the persisted phase is `focus` and expired: append a completion record (as today), then write a new `state.json` with `phase: "break"`, fresh `startedAt`/`durationMs`, `completedFocusBlocks` incremented, project preserved.
- If the persisted phase is `break` and expired: clear `state.json` (idle, awaiting next focus).
- If a focus expired in the past, then its break would also have already expired by the current `now`: handle in one call by looping until the derived state is non-expired or idle. At most one focus → one break → idle in practice.

Every call site that already invokes `finalizeIfExpired` (start, pause, resume, status, today) calls the new function. This is the seam that makes detach-and-time-passes correct.

**Start command.** `initTimer` is unchanged in shape: writes a fresh focus session at `now`. The "after-break idle" state looks identical to first-launch idle from `start`'s perspective.

**Stop command.** Unchanged: clears `state.json`.

**Status command.** Extended to report current phase and completed focus blocks. JSON output gains `phase` and `completedFocusBlocks` fields. Text output gains a short phase indicator. The existing `state: "idle" | "running" | "paused"` field stays.

**TUI App (`tui/App.tsx`).** Three changes:

1. Keybinding map:
   - `q`, `Ctrl+C`, `Esc` → detach (call `exit()`, no state mutation)
   - `space` → pause/resume, *writes through* to `state.json`
   - `x` → stop session (clear state, then detach)
   - `p` → project picker (unchanged)
   - `?` → help overlay (unchanged)
   - `s` (skip) → removed entirely
2. Mutations call shared functions from `state.ts` / `commands/*.ts` (e.g. `pauseTimer`, `resumeTimer`, `stopTimer`) rather than mutating an in-memory machine.
3. The tick interval becomes a re-read of `state.json` + `advancePhaseIfExpired`, then `deriveState` for the view. This eliminates the in-memory machine as a source of truth.

**Phase state machine (`tui/phase-state-machine.ts`).** Largely deleted. The "phase" concept now lives in `state.json` and `deriveState`. The phase-complete event emission used by the TUI to log focus blocks is replaced by `advancePhaseIfExpired`'s completion-append. If a small pure helper is still useful for rendering (e.g. "what break duration follows block N"), keep just that — but no mutable state, no listeners.

**Help overlay (`tui/HelpOverlay.tsx`).** Update the `BINDINGS` array: drop `s`, add `x` ("stop session"), reword `q` to "detach (timer keeps running)". Add a short hint that `Ctrl+C` and `Esc` also detach.

## Testing Decisions

The new seam is `advancePhaseIfExpired`. It deserves a unit test with these cases: idle → idle; focus running → focus running; focus expired → break running + completion logged; focus expired long ago and break also expired → idle + completion logged; break expired → idle (no completion); old record without phase fields → treated as focus.

`getStatus` gains assertions for the new `phase` and `completedFocusBlocks` fields in both text and JSON outputs.

The TUI keybinding test (`apps/cli/src/__tests__/timer-keybindings.test.tsx`) is extended to cover: `x` clears state; `q` / `Ctrl+C` / `Esc` exit without clearing state; `space` writes pause/resume to state; `s` is no longer bound.

A new integration test simulates detach: write a focus state, advance `now` past expiry, call `advancePhaseIfExpired`, assert disk holds a break state and one completion was appended. Then advance `now` past break expiry, call again, assert idle.

Existing prior art for state tests lives in `apps/cli/src/__tests__/state.test.ts` and `apps/cli/src/__tests__/pause-resume-stop.test.ts` — same patterns.

## Out of Scope

- Skip key (cut — was testing-only, no CLI peer, no persistence story).
- Break → focus auto-advance (deliberate non-decision: each focus starts with intent).
- In-TUI `today` log view.
- In-TUI project rename / archive (the picker stays select-or-create).
- Stop confirmation prompt (CLI `pmdr stop` doesn't confirm; TUI shouldn't either).
- Migration script for old `state.json` files — forward-compatible defaults are enough.
- Configurable focus / break durations from the TUI (still hardcoded defaults, same as today).

## Open Questions

None.
