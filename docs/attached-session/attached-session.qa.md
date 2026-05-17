# QA Plan: attached-session

## Already verified by the agent

### tui-detach
- [x] `pnpm --filter cli test` — 247/247 tests pass (added 3 new detach-key cases asserting each of `q`, `Ctrl+C`, `Esc` calls `exitFn` and leaves `state.json` byte-identical)

### schema-and-phase-advancement
- [x] `pnpm --filter cli test` — 247/247 tests pass (new `advancePhaseIfExpired` describe block covering idle no-op, focus-still-running no-op, expired focus → break + completion, focus+break both expired → idle with one completion, expired break → idle, legacy record defaulting, project preservation, short vs long break thresholds)
- [x] `tsc --noEmit` — no type errors

### status-reports-phase
- [x] `pnpm --filter cli test` — 250/250 tests pass (new assertions on `phase` / `completedFocusBlocks` in JSON for focus-running, focus-paused, break-running, legacy-record-defaulting; text-format coverage for focus-running, focus-paused, break-running)
- [x] `tsc --noEmit` — no type errors

### tui-mutations-persist
- [x] `pnpm --filter cli test` — 233/233 tests pass (one obsolete file of 20 cases removed, new integration test `tui-mutations-persist.test.tsx` added; updated `timer-keybindings.test.tsx` to use tmpdir-backed store)
- [x] `tsc --noEmit` — no type errors

### tui-stop-and-help-cleanup
- [x] `pnpm --filter cli test` — 234/234 tests pass (replaced `s skips phase` block with `s is no longer bound`, added `x stops session` block asserting `store.readState()` is null and `exitFn` called; updated `help-overlay.test.tsx` for new detach/stop labels and negative `skip` assertion)
- [x] `tsc --noEmit` — no type errors

---

## Human verification required

### Help overlay matches the new attached-session model (tui-stop-and-help-cleanup)
> Carries `Human checkpoint: yes`. Snapshot/rendering tests assert the binding strings but cannot verify visual alignment in a real terminal.

- [ ] Launch `pmdr` and press `?`. Confirm the help overlay shows: a single detach row reading `q / esc / ctrl+c` → "detach (timer keeps running)", an `x` row → "stop session", and **no** `skip` row.
- [ ] Confirm the key column and description column line up cleanly across all rows (padding was widened from 6 to 18 — verify nothing looks off-axis).
- [ ] Press `?` again to dismiss, confirm the timer is still ticking underneath.

### Detach vs stop semantics in a real terminal (tui-detach, tui-stop-and-help-cleanup)
- [ ] In shell A, run `pmdr start --duration 5m`. In shell B, run `pmdr` to attach.
- [ ] In shell B press `q`. Confirm shell B returns to prompt cleanly. From shell A, run `pmdr status` and confirm it still reports the session as running with the expected time remaining.
- [ ] Re-attach with `pmdr` (shell B). Press `Esc`. Confirm same detach behaviour — `pmdr status` from shell A still reports running.
- [ ] Re-attach with `pmdr` (shell B). Press `Ctrl+C`. Confirm same detach behaviour.
- [ ] Re-attach with `pmdr` (shell B). Press `x`. Confirm the TUI exits **and** `pmdr status` from shell A reports `idle`.

### Pause/resume persists across shells (tui-mutations-persist)
- [ ] Start a session and attach (`pmdr`). Press `space` to pause. In another shell run `pmdr status` — confirm it reports `focus paused — …`.
- [ ] Press `space` again to resume. Run `pmdr status` from the other shell — confirm it reports `focus — …` (running).

### Phase advancement in a live TUI (schema-and-phase-advancement, status-reports-phase)
- [ ] Start a short focus block (e.g. `pmdr start --duration 1m`), attach, and let it expire while attached. Confirm the TUI transitions to `BREAK` and `pmdr status` from another shell reports `break — …` with `completedFocusBlocks: 1` in `--json`.
- [ ] Let the break expire (or detach and re-check). Confirm the session ends idle with one completion in `pmdr today`.
- [ ] Run four short focus blocks in sequence and confirm the fourth break is the long-break duration (short vs long break threshold).
- [ ] Run `pmdr status --json` mid-focus and mid-break and eyeball that `phase` and `completedFocusBlocks` fields appear in the output and match the running state.

### Status text formatting (status-reports-phase)
- [ ] Run `pmdr status` during focus — confirm text reads `focus — MM:SS left (block N/4)`.
- [ ] Run `pmdr status` during a paused focus — confirm text reads `focus paused — MM:SS left (block N/4)`.
- [ ] Run `pmdr status` during break — confirm text reads `break — MM:SS left (N/4 done)`.
- [ ] Run `pmdr status` with no session — confirm text still reads `idle`.

### Project picker persists to disk (tui-mutations-persist)
> A small behavioural improvement that fell out of the refactor — not a slice in itself, but worth eyeballing.

- [ ] Attach to a running session, press `p`, pick a different project. Detach with `q`. Run `pmdr status --json` from another shell and confirm the `project` field reflects the new selection.

---

## Watch closely

### Dead `finalizeIfExpired` export (schema-and-phase-advancement)
The old `finalizeIfExpired` function is still exported from `state.ts` but no command call sites use it any more — `advancePhaseIfExpired` replaced them all. The agent left it in place to avoid bleeding scope; a future cleanup slice should delete it. If a downstream PR touches `state.ts`, this is the right moment to remove the dead export.

### Swallowed `pauseTimer` / `resumeTimer` errors in the space handler (tui-mutations-persist)
`pauseTimer` and `resumeTimer` can throw on idle or conflicting state (e.g. an expired-and-advanced race where the tick promoted focus → break between the keypress and the helper running). The TUI's `space` handler catches those errors silently and just re-reads the file to refresh the view. This is defensive shape mirroring `runCountdown` in `start.ts`, but it means a genuine bug in the helpers could be masked. If pause/resume ever appears to silently no-op in the TUI, instrument the catch first.

### Defensive `try/catch` around `stopTimer` (tui-stop-and-help-cleanup)
`stopTimer` returns false on idle state and does not throw on the live store, but `App.tsx` wraps it in `try/catch` because read-only-store test wrappers have a no-op `clearState`. The wrapping is harmless in production but obscures unexpected failures. If `x` ever appears to no-op in a real terminal, the catch is the first place to inspect.

### Read-only store wrapper (`makeReadOnlyStore`) (tui-mutations-persist)
`App.tsx` accepts an injectable `store` prop; older tests that only pass `readStateFn` get wrapped in a `makeReadOnlyStore` whose writes are no-ops. This keeps backwards compatibility with read-only fixtures but means any test that *should* observe a write needs to use the tmpdir-backed real store explicitly. New tests that test mutation behaviour without using the real store will silently pass when they should fail — author them against the real store.

### Block-count suffix semantics (status-reports-phase)
For focus phase the suffix shows the *next* block index (`completedFocusBlocks + 1`) because that block is in progress; for break phase it shows blocks completed so far (`completedFocusBlocks`). The semantics differ between phases by design but could surprise a reader of `pmdr status` — confirm during human verification that the displayed numbers match expectations.
