# QA Plan: interactive-tui

## Already verified by the agent

### ink-bootstrap
- [x] `pnpm --filter cli test` — 172/172 tests pass (all pre-existing tests unchanged)
- [x] `pnpm --filter cli check-types` — no type errors
- [x] `pnpm --filter cli build` — compiles cleanly (ESM dist/index.js 26.15 KB)

### phase-state-machine
- [x] `pnpm --filter cli test` — 192/192 tests pass (172 prior + 20 new unit tests covering: initial state, tick transitions, pause/resume idempotency, pause accumulation, skip from both phases, event emission, completedAt semantics, project propagation, CompletionWrite contract, two-cycle round-trip, long-break triggering)
- [x] `pnpm --filter cli check-types` — no type errors

### countdown-view
- [x] `pnpm --filter cli test` — 198/198 tests pass (192 prior + 6 new smoke tests: FOCUS label renders, BREAK label renders, red ANSI for focus, green ANSI for break, project name renders, hint line key bindings)
- [x] `pnpm --filter cli check-types` — no type errors

### timer-keybindings
- [x] `pnpm --filter cli test` — 203/203 tests pass (198 prior + 5 new: space pauses with gray ANSI, space-space resumes with red ANSI, s transitions focus→break, s while paused still skips, q does not throw)
- [x] `pnpm --filter cli check-types` — no type errors

### project-picker-overlay
- [x] `pnpm --filter cli test` — 218/218 tests pass (203 prior + 15 new: list rendering, navigation, selection, new-project flow, App-level integration)
- [x] `pnpm --filter cli check-types` — no type errors

### help-overlay
- [x] `pnpm --filter cli test` — 227/227 tests pass (218 prior + 9 new: rendering, component-level dismissal via `?` and esc, App-level open/close/timer-continues)
- [x] `pnpm --filter cli check-types` — no type errors

### launch-attach-or-fresh
- [x] `pnpm --filter cli test` — 234/234 tests pass (227 prior + 7 new: running attach shows FOCUS + project + red ANSI, running attach hides picker, paused attach shows gray ANSI + project, idle auto-opens picker, idle picker lists projects, esc on auto-opened picker closes and reveals timer)
- [x] `pnpm --filter cli check-types` — no type errors

---

## Human verification required

### Visual layout and color fidelity (countdown-view)
> The `countdown-view` log entry was marked `needs-review (Human checkpoint: yes)` — the ink-testing-library tests assert ANSI codes but cannot verify real-terminal rendering.

- [ ] Run `pmdr` in a real terminal. Confirm: phase label (`FOCUS`) is top-center, dim project name appears below it, `<BigText>` countdown renders in large block letters.
- [ ] Confirm the countdown ticks every second visually.
- [ ] Let the focus block expire naturally (use a short duration override). Confirm color changes from red → green as phase transitions to break.
- [ ] Confirm the completed-blocks dots row updates correctly after each focus block.
- [ ] Confirm the bottom hint bar reads: `space pause · s skip · p project · q quit · ? help`

### Keybinding behavior in a real terminal (timer-keybindings)
- [ ] Press `space` — countdown freezes and dims (gray). Press `space` again — countdown resumes (red).
- [ ] Press `s` — transitions immediately to the next phase without waiting for expiry.
- [ ] Press `q` — exits cleanly back to the shell prompt with no error output.
- [ ] Press `Ctrl+C` — exits cleanly back to the shell prompt with no error output.

### Project picker overlay in a real terminal (project-picker-overlay)
- [ ] Press `p` — overlay opens listing available projects plus a "new…" entry, with hint "Applies from next block".
- [ ] Arrow-key navigate the list; confirm highlight moves correctly.
- [ ] Select a project — overlay closes, countdown resumes, project name shown in the layout.
- [ ] Complete the current focus block and confirm the *next* block starts with the selected project name.
- [ ] Press `p`, select "new…", type a name, press Enter — confirm the project is created and selected.
- [ ] Press `p` then `esc` — confirm overlay closes without changing the current project.
- [ ] While the overlay is open, confirm the underlying timer is still ticking (check after closing).

### Help overlay in a real terminal (help-overlay)
- [ ] Press `?` — overlay opens showing all five keybindings and descriptions.
- [ ] Press `?` again — overlay closes.
- [ ] Press `esc` with overlay open — overlay closes.
- [ ] While overlay is open, confirm the underlying timer is still ticking (check after closing).

### Attach to running timer (launch-attach-or-fresh)
- [ ] In one shell, run `pmdr start --duration 2m`. In another shell, run `pmdr`. Confirm the TUI attaches and shows the remaining time and project from the running record.
- [ ] With a paused timer state, launch `pmdr`. Confirm the TUI attaches in paused/dimmed state.
- [ ] With no running timer (idle state), launch `pmdr`. Confirm the project picker auto-opens before the first focus block starts.

---

## Watch closely

### Ink escape-detection debounce (affects project-picker-overlay, help-overlay, launch-attach-or-fresh)
All three overlay slices discovered that Ink's escape-detection uses an internal debounce timeout. Tests use `vi.advanceTimersByTime(100)` (not `vi.runAllTimers()`) to advance past the debounce without triggering an infinite-loop from App's `setInterval`. A component-level fallback checks `input === "\x1B"` in addition to `key.escape`. If escape dismissal feels sluggish or unreliable in a real terminal, this debounce handling is the first place to investigate.

### ink v7 `useInput` microtask deferral (timer-keybindings)
Ink v7's `useInput` dispatches state updates via `reconciler.discreteUpdates`, which defers React re-renders to a microtask rather than completing synchronously. Tests require `await Promise.resolve()` after each keystroke to flush the render. If keybindings appear to miss inputs or lag by one render cycle in the real terminal, this rendering pipeline is the likely cause.

### countdown-view human checkpoint discrepancy
The `countdown-view` log entry carries `Status: needs-review (Human checkpoint: yes)` while the final tasks file records `Status: done` and `Human checkpoint: no`. The slice was presumably reviewed and accepted between log-write and task-close, but the visual layout (BigText, ANSI colors, column alignment) was never confirmed by a human. Give the visual checks above extra attention.

### Navigation test assertion approach (project-picker-overlay)
Navigation tests use `frame.includes("> alpha")` rather than `lastIndexOf` because both `lastIndexOf(">", alphaIdx)` and `lastIndexOf(">", betaIdx)` return the same position when alpha is highlighted. This means tests check presence of the highlight marker string but not its exact position. If the list renders multiple `>` characters in other contexts, the navigation tests could produce false positives.
