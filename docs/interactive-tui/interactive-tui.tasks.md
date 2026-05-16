# Interactive TUI

Adds a fullscreen Ink-based TUI for human users when `pmdr` is run with no subcommand. Existing subcommands remain untouched so agent workflows keep working.

## Slices

### `ink-bootstrap` — Ink app mounted from bare `pmdr`

**Status:** done

**Outside-in:** Running `pmdr` with no subcommand mounts an Ink app and renders a placeholder fullscreen frame; running any existing subcommand (`pmdr start`, `pmdr status`, etc.) is byte-identical to before.

**Feedback loop:** Manual: `pmdr` shows the placeholder frame and exits cleanly on `Ctrl+C`. Automated: existing CLI tests (`start.test.ts`, `state.test.ts`, etc.) still pass.

**Human checkpoint:** no

**Depends on:** none

### `phase-state-machine` — Focus/break phase state machine

**Status:** not-started

**Outside-in:** A module exporting a state machine with `tick(now)`, `pause(now)`, `resume(now)`, `skip(now)` events; emits `phase-complete` events at boundaries; exposes derived `{ phase, remainingMs, completedFocusBlocks, paused }` for rendering.

**Feedback loop:** Unit tests with an injected deterministic clock — verify focus→break→focus cycling, pause accumulates correctly, skip emits completion and transitions, completion events log via existing `state.ts` completion contract.

**Human checkpoint:** no

**Depends on:** none

### `countdown-view` — Fullscreen countdown layout

**Status:** not-started

**Outside-in:** Bare `pmdr` shows: phase label (`FOCUS`/`BREAK`) top-center, dim project name below it, `<BigText>` countdown in ANSI red (focus) or green (break) or dim (paused), completed-blocks dots row, bottom hint line `space pause · s skip · p project · q quit · ? help`.

**Feedback loop:** Manual: launch with a short overridden focus duration, watch it tick through to break and observe red→green color transition. Automated: `ink-testing-library` smoke test asserting phase label and color match the state-machine output.

**Human checkpoint:** yes

**Depends on:** ink-bootstrap, phase-state-machine

### `timer-keybindings` — Pause, skip, quit keys

**Status:** not-started

**Outside-in:** Inside the TUI: `space` toggles pause/resume (countdown freezes and dims), `s` skips to the next phase (logs completion of current block, transitions immediately), `q` and `Ctrl+C` quit cleanly back to the shell.

**Feedback loop:** `ink-testing-library` tests dispatching each key and asserting state-machine transitions / exit behavior. Manual: press each key, observe expected behavior.

**Human checkpoint:** no

**Depends on:** countdown-view

### `project-picker-overlay` — Project switch overlay

**Status:** not-started

**Outside-in:** Pressing `p` opens an overlay listing all non-archived projects plus a "new…" entry; selecting one sets the project for the *next* block (overlay hint reads "Applies from next block"); the current timer continues ticking underneath the overlay; selecting "new…" prompts for a name and creates it via `createProjectsModule`.

**Feedback loop:** `ink-testing-library` smoke test: open overlay, select a project, verify state machine's next-block project is updated. Manual: switch project mid-focus, let the block complete, confirm next block shows the new project.

**Human checkpoint:** no

**Depends on:** countdown-view

### `help-overlay` — Keybinding help overlay

**Status:** not-started

**Outside-in:** Pressing `?` toggles a centered overlay listing all keybindings (`space`, `s`, `p`, `q`, `?`); pressing `?` again or `esc` closes it; timer continues ticking underneath.

**Feedback loop:** `ink-testing-library` test: press `?`, assert overlay renders; press again, assert it dismisses. Manual: open and close.

**Human checkpoint:** no

**Depends on:** countdown-view

### `launch-attach-or-fresh` — Attach to running timer or start fresh

**Status:** not-started

**Outside-in:** On `pmdr` launch: if `state.ts` reports a `running` or `paused` timer, the TUI attaches to it and renders from its current remaining time and project; if `idle`, the project picker overlay opens automatically before the first focus block starts.

**Feedback loop:** Integration test: seed state with a running record, launch TUI, assert attached state matches. Seed idle state, launch, assert picker overlay is shown. Manual: run `pmdr start --duration 30s` then `pmdr` in another shell, confirm attach.

**Human checkpoint:** yes

**Depends on:** countdown-view, project-picker-overlay
