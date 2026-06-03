# Manual break start and transition sounds

Breaks no longer auto-start when a focus block expires — they're created born-paused at full duration and started explicitly via existing resume affordances — and the menubar plays stock system sounds (Glass / Submarine) at phase ends. See `manual-break-start-and-sounds.prd.md` and `scope.md` in this directory.

## Slices

### `born-paused-break` — State module: break born paused

**Status:** done

**Outside-in:** `pmdr status --json`, minutes after a focus block expires, reports `state: "paused", phase: "break"` with the full break duration in `remainingMs` (5 min, or 15 min for a long break).

**Feedback loop:** State-module vitest cases: focus expiry yields a break-phase record paused at the completion moment; remaining time is stable arbitrarily long after expiry; the chained-expiry loop does not advance a pending break; long-break selection still applies; a resumed break that expires clears to idle.

**Human checkpoint:** no

**Depends on:** none

### `cli-flows-pending-break` — CLI session flows on a pending break

**Status:** done

**Outside-in:** `pmdr resume` (and space in the TUI) starts the pending break with the nominal end shifted correctly; `pmdr start` still refuses while the break is pending and `pmdr start --force` replaces it; the foreground `pmdr start` countdown ends with break-ready messaging (how to start it) instead of implying the break is running.

**Feedback loop:** Pause-resume-stop and start-command vitest cases covering resume-from-pending, start guards, `--force`, and the countdown's expired-branch output.

**Human checkpoint:** no

**Depends on:** born-paused-break

### `menubar-sounds-and-copy` — Menubar sounds and notification copy

**Status:** done

**Outside-in:** With the menubar app running, the focus → break(pending) transition plays the "Glass" system sound and posts a notification reading "Break ready" (not "Break started"); the break → idle transition plays "Submarine". Sound names are named constants.

**Feedback loop:** `PhaseNotifierTests` asserting through an injected sound-player fake (protocol over `NSSound`): Glass + "Break ready" copy on focus→break, Submarine on break→idle, no sound on unchanged polls or other transitions — including that detection fires when the new break state arrives as *paused*.

**Human checkpoint:** no

**Depends on:** none
