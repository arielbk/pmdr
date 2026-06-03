# PRD: Manual break start and transition sounds

## Resources

- Scope decisions: `/Users/arielbk/.trace/tasks/271d0e57-0f84-4eaa-91f9-2b55570a898b/docs/scope.md` (Trace task `manual-break-start-and-sounds`; this session is bound to it — keep task docs there current as decisions evolve).

## Problem Statement

When a focus block ends, the break starts automatically. In practice the user is often still wrapping up — a couple of minutes of overrun — and by the time they actually step away, the break has already been silently eaten ("only three minutes left in my break"). There is also no audible cue at phase boundaries, so the user can't notice a focus block ending (or a break ending) without looking at a screen.

## Solution

The break no longer starts itself. When a focus block expires, the break is created **born-paused** at its full duration (5 minutes, or 15 for a long break) and waits indefinitely. The user starts it explicitly with the affordances they already know: space in the TUI, `pmdr resume` from any terminal, or the menubar's resume action. Wrapping up late costs nothing — the full break is still there whenever they take it.

The menubar app — the always-running surface where the user would actually hear it — plays a pleasant stock macOS system sound at each phase end: "Glass" when focus completes (break is ready) and "Submarine" when the break completes (time to get back to it). Sound names live in named constants so a later configurability pass can lift them into settings; nothing is configurable now.

## User Stories

1. As a user wrapping up a thought past the focus timer, I want the break to wait for me at its full duration, so that running over doesn't shorten my break.
2. As a user whose focus block just ended, I want to start the break with the same key/command I already use for resume (space / `pmdr resume`), so that there's nothing new to learn.
3. As a user away from or not looking at the screen, I want to hear a pleasant sound when my focus block completes, so that I notice the break is ready without watching a timer.
4. As a user on a break, I want to hear a distinct, softer sound when the break completes, so that I know it's time to start the next block.
5. As a user glancing at any surface (TUI, menubar, LAN status page), I want the pending break shown as a paused break with full time remaining, so that the state is legible everywhere without new UI.
6. As a menubar user, I want the focus-complete notification to say the break is *ready* (not "started"), so that the copy matches what actually happened.
7. As a user who checks status minutes after a focus block expired, I want `pmdr status --json` to still report the paused break with full remaining time, so that scripts and agents see a truthful, stable state.
8. As a user who'd rather skip the break, I want `pmdr stop` / `pmdr start --force` to keep working from the pending-break state, so that I'm never trapped in it.
9. As a user running `pmdr start` in the foreground, I want the countdown to end with a clear "break ready" message when the focus block completes, so that the terminal output doesn't imply a break is running.

## Implementation Decisions

- **Born-paused break (state module).** The phase-advance routine, on focus expiry, transitions to the break phase with the pause timestamp set to the focus completion moment, instead of starting the break running. The break duration logic (short vs long after every 4th block) is unchanged. The chained-expiry loop must not advance a pending (paused) break — a paused phase never expires, which the existing wall-clock derivation already guarantees since pausing freezes remaining time. Once resumed, break expiry clears to idle exactly as today.
- **No new state kind.** A pending break is reported as the existing paused state with break phase and full remaining duration. Every consumer — TUI, menubar, LAN status page, scripts — renders it correctly with zero changes. Accepted trade-off: "break ready, never started" is indistinguishable from "break paused midway"; nothing currently needs the distinction.
- **Resume is the start affordance.** The existing resume command/keybinding starts the pending break (pause accounting begins from the completion moment, so resuming shifts the nominal end forward correctly with no special-casing). No new shortcuts.
- **Foreground countdown copy.** The start command's foreground countdown, on focus expiry, ends with messaging that the break is ready and how to start it, rather than implying the break began.
- **Menubar sounds (PhaseNotifier).** The menubar's existing transition detection gains direct sound playback via `NSSound` stock system sounds — "Glass" on focus → break(pending), "Submarine" on break → idle — independent of notification permission/banner settings. Playback goes through a small injectable sound-player protocol so it can be asserted in tests. Sound names are named constants.
- **Notification copy.** The focus-complete notification body changes from "Break started" to "Break ready".

## Testing Decisions

All three modules get tests, extending the existing suites (the CLI uses vitest with a state-module test file and a pause/resume/stop flow file; the menubar core has a PhaseNotifier test file with an existing seam pattern):

- **State module:** focus expiry yields a break-phase record paused at the completion moment with full break duration remaining; remaining time is stable arbitrarily long after expiry; the chained-expiry loop does not advance a pending break; long-break duration selection still applies; resumed break expiry clears to idle.
- **Session flows:** resume on a born-paused break starts it and shifts the nominal end correctly; `pmdr start` still refuses while the break is pending and `--force` still replaces it; foreground countdown exits with break-ready messaging on focus expiry.
- **PhaseNotifier:** focus → break transition plays "Glass" and posts a notification with "Break ready" copy; break → idle plays "Submarine"; no sound on unchanged polls or other transitions. Tests assert through the injected sound player — no audible output in CI.

## Out of Scope

- New keyboard shortcuts or global hotkeys (existing space/resume covers it).
- Sounds in the CLI/TUI — menubar only.
- Sounds for start/pause/resume events — phase-end events only.
- Sound or shortcut configurability (later pass; constants are the only accommodation).
- A dedicated "skip break" affordance (`pmdr stop` / `pmdr start --force` suffice).
- Overtime tracking/display for time worked past a focus block.
- A distinct pending-break state in the status JSON or any client UI changes beyond notification copy.
