# Attached Session — Implementation Log

## tui-detach

**Date:** 2026-05-17
**Status:** done

### What was done

Added `Esc` as a detach key alongside the existing `q` and `Ctrl+C`, and introduced an injectable `exitFn` prop to `App.tsx` so tests can assert exit is called without reaching into Ink internals.

**Files changed:**
- `apps/cli/src/tui/App.tsx` — added `exitFn?: () => void` prop; fall back to `useApp().exit` in production; extended the detach key condition to include `key.escape || input === "\x1B"`
- `apps/cli/src/__tests__/timer-keybindings.test.tsx` — new describe block: 3 tests each verifying (a) the detach key invokes `exitFn` and (b) `state.json` on disk is byte-identical before and after

### Observations

- Ink disambiguates a bare `\x1B` from escape sequences via a short timer; tests that write `\x1B` need `vi.advanceTimersByTime(100)` before the flush assertion (pattern already established in `launch-attach-or-fresh.test.tsx`)
- None of the three detach keys touch state.json — `exit()` simply unmounts the Ink process; no file mutations happen, which is the correct detach behaviour
- Full suite: 247/247 passing

## schema-and-phase-advancement

**Date:** 2026-05-17
**Status:** done

### What was done

Extended `StateRecord` with optional `phase: "focus" | "break"` and `completedFocusBlocks: number` fields (both defaulted on read), and added `advancePhaseIfExpired(now)` which loops: on expired focus it appends a completion and writes a fresh break record (preserving project, choosing short vs long break by `completedFocusBlocks % 4`); on expired break it clears state. All `finalizeIfExpired` call sites in commands (`start`, `pause`, `resume`, `status`, `today`) were swapped to `advancePhaseIfExpired`, and `initTimer` now stamps new sessions with `phase: "focus"` and `completedFocusBlocks: 0`.

**Files changed:**
- `apps/cli/src/state.ts` — schema fields, `computeBreakDurationMs`, `advancePhaseIfExpired` loop, exported wrapper
- `apps/cli/src/commands/{start,pause,resume,status,today}.ts` — call-site swap from `finalizeIfExpired` to `advancePhaseIfExpired`; `start.ts` also writes phase/count on init
- `apps/cli/src/__tests__/state.test.ts` — new `advancePhaseIfExpired` describe block: idle no-op, focus-still-running no-op, expired focus → break + completion, focus-then-break both expired → idle + one completion, expired break → idle no completion, legacy record (missing phase) treated as focus/0, project preserved into break, short vs long break thresholds
- `apps/cli/src/__tests__/{start,status,today,pause-resume-stop,log-with-project}.test.ts` — minor adjustments so existing fixtures still pass under the new code path

### Observations

- `finalizeIfExpired` is left in place (still exported) but unused by commands — leaving it for now to avoid touching unrelated removal scope; future cleanup slice may delete it
- The advancement loop handles the edge where focus expires far enough in the past that the break would also have already expired by `now` — we walk both transitions in one call and end up idle with exactly one focus completion logged
- Full suite: 247/247 passing; `tsc --noEmit` clean
