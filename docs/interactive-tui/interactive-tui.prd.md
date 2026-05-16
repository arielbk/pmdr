# PRD: Interactive TUI

## Problem Statement

`pmdr` today is great for agents — subcommands have stable, parseable output. But for a human running a pomodoro in their terminal, the experience is flat: you run `pmdr start`, see a small ticking line, and that's it. There's nothing to look at, nothing to interact with, no sense of presence. The CLI is missing the human side.

## Solution

When a human runs `pmdr` with no subcommand, launch a fullscreen Ink-based TUI that takes over the terminal. The TUI shows a large ASCII countdown of the current block, the active project, the phase (focus/break), and the count of completed focus blocks this session. It auto-cycles between focus and break blocks until the user quits, and supports keybindings for pausing, skipping, switching project, and quitting. Existing subcommands (`start`, `pause`, `resume`, `stop`, `status`, `today`, `project`) are untouched so agent workflows are byte-identical.

## User Stories

1. As a human user, I want running `pmdr` with no args to open a fullscreen interactive pomodoro view, so that I get a visually engaging timer without having to remember a subcommand.
2. As a human user, I want a big, easy-to-read ASCII countdown in the centre of the screen, so that I can glance at my terminal from across the room and know how long is left.
3. As a human user, I want the screen to be red during focus and green during break, so that I can tell which phase I'm in at a glance.
4. As a human user, I want the colors to use ANSI named colors, so that they pick up my terminal theme rather than clashing with a hardcoded RGB value.
5. As a human user, I want the current project name displayed prominently, so that I always know what I'm tracking time against.
6. As a human user, I want a row of dots indicating how many focus blocks I've completed this session, so that I get a small sense of progress.
7. As a human user, I want focus → break and break → focus transitions to happen automatically when the timer hits zero, so that I don't break flow reaching for a key every 25 minutes.
8. As a human user, I want to press `space` to pause and resume the current timer, so that I can step away without losing the block.
9. As a human user, I want to press `s` to skip the current phase, so that I can move on if I finish early or want to cut a break short.
10. As a human user, I want to press `p` to open a project picker overlay that switches the active project for the *next* block, so that I can change context without corrupting the current block's logged time.
11. As a human user, I want to press `?` to toggle a help overlay listing the keybindings, so that I don't have to memorise them.
12. As a human user, I want `q` or `Ctrl+C` to quit cleanly back to the shell, so that exiting feels natural.
13. As a human user, I want a dim hint line at the bottom of the screen showing the main keybindings, so that the controls are discoverable without opening help.
14. As an agent, I want all existing subcommands (`pmdr start`, `pmdr status`, etc.) to behave exactly as before, so that my scripts don't break.
15. As a human user launching `pmdr` without a previously-selected project, I want the project picker overlay to appear immediately, so that I can choose what I'm working on before the timer starts.

## Implementation Decisions

**Entry point.** The root command in `apps/cli/src/index.ts` gains a `run` handler that, when invoked with no subcommand, dispatches to the TUI module. Subcommands continue to take precedence.

**TUI app.** A new module mounts an Ink app and renders the fullscreen view. Built on `ink` and `ink-big-text` (which wraps `cfonts`). Layout:

- Top: phase label (`FOCUS` / `BREAK`), dim project name below it
- Centre: `<BigText>` countdown in ANSI red (focus) or green (break); dim/grey when paused
- Below centre: completed-blocks dots (filled circle for completed focus blocks, hollow for not-yet)
- Bottom: dim hint line — `space pause · s skip · p project · q quit · ? help`

**Phase state machine.** A small in-memory state machine drives the lifecycle: `focus → break → focus → …`, alternating indefinitely. Each phase has a duration (focus: 25min, break: 5min — same defaults as existing `start`). On phase end it logs the completed block via the existing state/completion module, then immediately starts the next phase. There is no long break and no fixed session length; the user quits to end the session.

**Pause/resume.** Tracks `pausedAt` and `accumulatedPauseMs` in the same shape as the existing state module so completion logging stays consistent. While paused, timer rendering switches to a dim style and the countdown does not advance.

**Project picker overlay.** A new Ink component that reuses the project list from `projects.ts`. Switching applies to the *next* block, not the current one; the overlay shows a hint to that effect. The current block continues running underneath the overlay (timer keeps ticking). Includes a "new…" entry for creating projects inline, matching the existing `pickProject` behaviour.

**Help overlay.** Static keybinding reference, toggled by `?`.

**Reuse vs new.** Reuses `state.ts` (completion logging, the `StateRecord` shape), `projects.ts` (list / create projects), and `parse-duration.ts` if needed. The existing `pickProject` in `commands/start.ts` is clack-based and not reusable inside Ink — the project-picker overlay is a new Ink component that calls the same `createProjectsModule` underneath.

**Notifications.** Out of scope for v1 (see below).

## Testing Decisions

The phase state machine is the most valuable thing to unit-test in isolation: given a sequence of "tick" and "skip" and "pause" events with a deterministic clock, it should transition between phases correctly and log completions at the right boundaries. Mirror the deterministic-clock style used in the existing `state.test.ts` and `start.test.ts`.

The Ink components themselves (countdown, overlays, hint line) are best tested with `ink-testing-library` for a couple of smoke tests — that the right phase label and color appear, that `?` toggles help, that `p` opens the project overlay. Don't aim for pixel-level snapshotting; behaviour over rendering.

Existing CLI subcommand tests must continue to pass unchanged — this is the contract that protects agent workflows.

## Out of Scope

- ASCII tomato sprite (cut during scoping).
- OS notifications when a block ends. The TUI being a long-lived foreground process makes them feasible later, but no notification mechanism exists in the codebase today; adding one is a separate feature.
- Long breaks / fixed N-block sessions / configurable block counts.
- Theming, color config, light/dark detection.
- Restart-current-block, extend-by-N-minutes, jump-to-focus-from-break.
- Auto-detect TTY in `pmdr start` to switch between TUI and static output (rejected as too magic).
- A clock, date, task description, or anything not directly part of the pomodoro view.
- Changes to existing subcommands or their output format.

## Open Questions

- Should `Ctrl+C` and `q` behave identically (both quit cleanly, logging the current partial block as abandoned), or should `Ctrl+C` be a "hard exit" that does not log? Default plan: both quit cleanly, no logging of partial blocks.
- When the user launches `pmdr` and there is *already* a running timer (from a prior `pmdr start`), should the TUI attach to it, or refuse to launch? Default plan: attach — render the existing block, then continue cycling from there.
