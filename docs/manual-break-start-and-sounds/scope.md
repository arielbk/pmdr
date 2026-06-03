# Scope: manual-break-start-and-sounds

Scoped 2026-06-03 via /scope. Session fd653407-f93d-45da-8ca7-1c7e9c699331.

## Building

1. **Born-paused break** — when focus expires, `advancePhaseIfExpired()` (`apps/cli/src/state.ts:181`) transitions to `phase: "break"` with `pausedAt` set to the completion moment instead of auto-running. Break holds its full duration (5 or 15 min) until explicitly resumed via existing space (TUI) / `pmdr resume`. The chained expiry loop must not auto-expire a pending (paused) break; once resumed, break expiry still clears to idle as today.
2. **Menubar sounds via NSSound** — in `PhaseNotifier.swift`'s existing transition detection:
   - focus → break (pending): `NSSound(named: "Glass")`
   - break → idle: `NSSound(named: "Submarine")`
   - Sound names as named constants (configurability comes later).
3. **Notification copy fix** — focus→break notification body changes from "Break started" to "Break ready" (break no longer auto-starts).

## Not building (cut list)

- New keyboard shortcuts or global hotkeys — existing space/`pmdr resume` covers starting the break.
- Sounds in the CLI/TUI — menubar only (that's where the user hears it).
- Sounds on start/pause/resume — phase-end events only.
- A distinct "pending-break" state in `status --json` — born-paused reuses `state: "paused", phase: "break"`; all clients (TUI, menubar, LAN status page) render it with no changes.
- Sound/shortcut configurability — deferred to a later pass.
- "Skip break" affordance — `pmdr stop` / `pmdr start --force` is fine for v1.
- Overtime display for running past a focus block.

## Done when

A focus session that expires leaves the break paused at its full duration (verifiable via `pmdr status --json` → `state: "paused", phase: "break", remainingMs: 300000` even minutes after expiry); space/`pmdr resume` starts it; the menubar plays Glass at focus-end with a "Break ready" notification and Submarine at break-end.

## Key code anchors

- `apps/cli/src/state.ts:181` — `advancePhaseIfExpired()` (the transition to change)
- `apps/cli/src/state.ts:30-34` — `computeBreakDurationMs()` (5/15 min logic, unchanged)
- `apps/cli/src/commands/resume.ts` — existing resume (should work unchanged on a born-paused break)
- `apps/menubar/Sources/PmdrMenubarCore/PhaseNotifier.swift:19-38` — transition detection + notification copy; add NSSound here
- `apps/cli/src/commands/start.ts:29-34,166-173` — start guards + the `runCountdown` expired branch (writes "Pomodoro complete!" with a terminal bell `\x07`; verify it behaves sensibly with born-paused)
