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
