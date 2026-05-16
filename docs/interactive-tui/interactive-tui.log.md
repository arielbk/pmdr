# Interactive TUI — Implementation Log

---

## project-picker-overlay — 2026-05-16

**Slice:** `project-picker-overlay`
**Status:** done

**What was done:**
- Created `apps/cli/src/tui/ProjectPickerOverlay.tsx`: a self-contained overlay component that accepts `projects: ProjectRecord[]`, `onSelect(name: string)`, and `onClose()` props. Arrow keys navigate the list; Enter selects the highlighted entry (or, if "new…" is highlighted, enters text-input mode); Escape closes the overlay. Text-input mode is hand-rolled via `useInput` — printable characters append to state, `\x7f`/backspace removes the last char, Enter confirms, Escape returns to the list. The component handles both `key.escape` and the raw `input === "\x1B"` case to work correctly in Ink's testing environment.
- Updated `apps/cli/src/tui/App.tsx`: added `showProjectPicker`, `currentProject`, and `pickerProjects` state; added a `p` key handler (active only when overlay is closed) that fetches projects and opens the picker; wires `handleProjectSelect` (calls `upsertProjectFn`, `machine.setProject`, sets `currentProject`) and `handlePickerClose`; passes `currentProject` to `CountdownView`; conditionally renders `ProjectPickerOverlay` on top of the countdown view. The App now accepts optional `getProjects` and `upsertProjectFn` props for test injection, defaulting to the real `listProjects` / `upsertProject` implementations. App's `useInput` is set `isActive: !showProjectPicker` so keystrokes don't leak through to the timer while the overlay is open.
- Created `apps/cli/src/__tests__/project-picker-overlay.test.tsx` with 15 tests: list rendering (shows projects, "new…", "Applies from next block" hint, initial highlight), navigation (down arrow, up arrow clamping), selection (Enter selects, down+Enter selects second, Escape closes), new-project flow (selecting "new…" shows prompt, typing+Enter calls onSelect, backspace removes chars, Escape returns to list), App-level integration (pressing `p` opens overlay, selecting project shows name in countdown, overlay closes).
- Navigation tests use `frame.includes("> alpha")` / `frame.includes("> beta")` rather than `lastIndexOf` because when alpha is highlighted both `lastIndexOf(">", alphaIdx)` and `lastIndexOf(">", betaIdx)` return the same position.
- Escape tests use `vi.runAllTimers()` after `stdin.write("\x1B")` to advance Ink's internal escape-detection debounce timeout; the component also checks `input === "\x1B"` as a fallback for environments where `key.escape` isn't set by the time the handler fires.

**Feedback loop result:**
- `pnpm --filter cli test` — 218/218 tests pass (203 prior + 15 new) ✓
- `pnpm --filter cli check-types` — no type errors ✓

---

## timer-keybindings — 2026-05-16

**Slice:** `timer-keybindings`
**Status:** done

**What was done:**
- Updated `apps/cli/src/tui/App.tsx`: added `space` and `s` handlers inside the existing `useInput` block. Pressing `space` reads current paused state from the machine and calls `machine.pause(now)` or `machine.resume(now)`, then immediately calls `setViewState(machine.getState(now))` so the view updates without waiting for the next 500 ms interval tick. Pressing `s` calls `machine.skip(now)` then immediately updates viewState.
- `q` / `Ctrl+C` were already wired; no change needed there.
- Created `apps/cli/src/__tests__/timer-keybindings.test.tsx` with 5 tests: space pauses (gray ANSI), space-space resumes (red ANSI), s transitions focus→break, s while paused still skips to break, q does not throw.
- Discovered that ink v7's `useInput` dispatches state updates via `reconciler.discreteUpdates`, which defers the React re-render to a microtask. Tests needed `await Promise.resolve()` after each `stdin.write()` to flush the render before asserting.

**Feedback loop result:**
- `pnpm --filter cli test` — 203/203 tests pass (198 prior + 5 new) ✓
- `pnpm --filter cli check-types` — no type errors ✓

---

## countdown-view — 2026-05-16

**Slice:** `countdown-view`
**Status:** needs-review (Human checkpoint: yes)

**What was done:**
- Installed `ink-big-text`, `figlet`, and `@types/figlet` as dependencies.
- Created `apps/cli/src/tui/CountdownView.tsx`: renders a fullscreen countdown layout with:
  - Phase label (`FOCUS`/`BREAK`) centered at top (bold `<Text>`)
  - Dim project name row below the label
  - `<BigText>` countdown (formatted as `MM:SS`) with `colors: ['red']` for focus, `['green']` for break, `['gray']` for paused
  - Completed-blocks dots row (`○` when zero, `● ● …` otherwise), dimmed when paused
  - Bottom hint bar: `space pause · s skip · p project · q quit · ? help`
- Updated `apps/cli/src/tui/App.tsx`: replaced placeholder frame with `CountdownView`; wires up `createPhaseStateMachine`, a `setInterval` tick every 500 ms via `useEffect`, and derived `viewState` via `useState`; `q` / `Ctrl+C` still exits.
- Created `apps/cli/src/__tests__/countdown-view.test.tsx` with 6 smoke tests covering: FOCUS label renders, BREAK label renders, red ANSI color for focus, green ANSI color for break, project name renders, hint line key bindings.

**Feedback loop result:**
- `pnpm --filter cli test` — 198/198 tests pass (192 prior + 6 new) ✓
- `pnpm --filter cli check-types` — no type errors ✓

---

## phase-state-machine — 2026-05-16

**Slice:** `phase-state-machine`
**Status:** done

**What was done:**
- Created `apps/cli/src/tui/phase-state-machine.ts`: a pure, clock-injected state machine with `tick(now)`, `pause(now)`, `resume(now)`, `skip(now)`, `getState(now)`, `on('phase-complete', listener)`, and `setProject(name)`. Internal state tracks phase, start time, duration, accumulated pause ms, and completed focus block count.
- Phase transitions: focus → break → focus cycling; break duration is short (default 5 min) or long (default 15 min) based on `longBreakAfter` (default: every 4th block).
- `tick` detects natural expiry and fires transition; `skip` fires transition immediately with `completedAt = now` rather than the nominal end.
- `phase-complete` events carry `{ phase, completedAt, durationMs, project? }`, matching the `CompletionWrite` contract from `state.ts` so callers can pass directly to `appendCompletion` (with a `?? "(unassigned)"` fallback).
- Created `apps/cli/src/__tests__/phase-state-machine.test.ts` with 20 unit tests covering: initial state, tick transitions, pause/resume idempotency, pause accumulation, skip from both phases, event emission (natural and skip), completedAt semantics, project propagation, CompletionWrite contract, two-cycle round-trip, and long-break triggering.

**Feedback loop result:**
- `pnpm --filter cli test` — 192/192 tests pass (172 prior + 20 new) ✓
- `pnpm --filter cli check-types` — no type errors ✓

---

## ink-bootstrap — 2026-05-16

**Slice:** `ink-bootstrap`
**Status:** done

**What was done:**
- Installed `ink` and `react` as production dependencies; `@types/react` and `ink-testing-library` as devDependencies.
- Updated `tsconfig.json`: added `"jsx": "react-jsx"` to compilerOptions and added `"src/**/*.tsx"` to the `include` array.
- Created `apps/cli/src/tui/App.tsx`: a minimal Ink component that renders a placeholder fullscreen frame (centered "PMDR — Interactive TUI" label and a dim hint bar at the bottom). Handles `q` to quit via `useApp().exit()`.
- Updated `apps/cli/src/index.ts`: added a `run` handler to the citty root command that dynamically imports `ink` and `./tui/App.js`, mounts the Ink app, and awaits `waitUntilExit()`. Dynamic imports keep the handler lazy — subcommands never pay the Ink import cost.

**Feedback loop result:**
- `pnpm --filter cli test` — 172/172 tests pass (all existing tests unchanged) ✓
- `pnpm --filter cli check-types` — no type errors ✓
- `pnpm --filter cli build` — compiles cleanly (ESM dist/index.js 26.15 KB) ✓
