# Attached Session

Make the TUI a true attached view onto a persisted pomodoro session: extend `state.json` to model the full cycle, persist every TUI mutation, and split detach (`q`/`Ctrl+C`/`Esc`) from stop (`x`).

## Slices

### `schema-and-phase-advancement` — Extend state schema and persist phase transitions

**Status:** in-progress

**Outside-in:** `advancePhaseIfExpired(now)` exported from `state.ts` — replaces `finalizeIfExpired` at all call sites. Reads `state.json`, and: if focus expired, appends a completion and writes a fresh break record (incrementing `completedFocusBlocks`, preserving project); if break expired, clears state; loops until stable. `StateRecord` gains `phase: "focus" | "break"` and `completedFocusBlocks: number`, both defaulted to `"focus"` / `0` when missing from old records.

**Feedback loop:** Unit tests in `apps/cli/src/__tests__/state.test.ts` covering: idle stays idle; running focus stays running; expired focus → break running + one completion appended; expired focus whose break also already expired → idle + one completion; expired break → idle (no completion); old record without phase fields read as focus/0.

**Human checkpoint:** no

**Depends on:** none

---

### `status-reports-phase` — Surface phase and block count in `pmdr status`

**Status:** not-started

**Outside-in:** `pmdr status` text output includes a phase indicator and completed focus block count. `pmdr status --json` gains `phase` and `completedFocusBlocks` fields. Existing `state: "idle" | "running" | "paused"` field stays for backward compatibility.

**Feedback loop:** `apps/cli/src/__tests__/status.test.ts` extended with cases asserting `phase` and `completedFocusBlocks` appear in JSON output and in text formatting for focus-running, focus-paused, and break-running states.

**Human checkpoint:** no

**Depends on:** `schema-and-phase-advancement`

---

### `tui-detach` — Detach keys leave the session running

**Status:** done

**Outside-in:** In the TUI, pressing `q`, `Ctrl+C`, or `Esc` calls `exit()` and returns control to the shell *without* mutating `state.json`. A subsequent `pmdr status` from another shell still reports the session as running (or paused, whichever it was).

**Feedback loop:** `apps/cli/src/__tests__/timer-keybindings.test.tsx` extended with cases verifying: (a) each of `q`, `Ctrl+C`, `Esc` triggers `exit()`; (b) `state.json` on disk is byte-identical before and after each detach key.

**Human checkpoint:** no

**Depends on:** none

---

### `tui-mutations-persist` — TUI reads and writes through `state.json`

**Status:** not-started

**Outside-in:** TUI's tick interval re-reads `state.json` and runs `advancePhaseIfExpired(now)` instead of mutating an in-memory phase machine. `space` calls the shared `pauseTimer` / `resumeTimer` helpers from `commands/pause.ts` / `commands/resume.ts` so pause state is written to disk. The in-memory phase state machine module is removed (or reduced to a pure rendering helper if anything remains).

**Feedback loop:** Two layers — (a) `timer-keybindings.test.tsx` asserts `space` calls `writeState` with the expected paused/resumed payload; (b) a new integration test simulating attach → pause → assert `pmdr status` reports paused → resume → assert running. Existing `__tests__/pause-resume-stop.test.ts` is the prior-art pattern.

**Human checkpoint:** no

**Depends on:** `schema-and-phase-advancement`

---

### `tui-stop-and-help-cleanup` — Add `x` for stop, remove skip, refresh help

**Status:** not-started

**Outside-in:** Pressing `x` in the TUI clears `state.json` (via `stopTimer`) then exits, equivalent to running `pmdr stop` from another shell. The `s` (skip) binding is removed entirely. `HelpOverlay`'s `BINDINGS` array reflects the new model: detach keys labelled "detach (timer keeps running)", `x` labelled "stop session", no skip entry.

**Feedback loop:** `timer-keybindings.test.tsx` asserts `x` clears state and exits, and that `s` is no longer bound. `__tests__/help-overlay.test.tsx` updated/snapshotted to show the new binding rows. Manual: launch TUI, press `?`, eyeball the help overlay matches the model.

**Human checkpoint:** yes

**Depends on:** `tui-detach`, `tui-mutations-persist`
