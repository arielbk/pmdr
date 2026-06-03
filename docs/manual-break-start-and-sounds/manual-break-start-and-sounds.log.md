# Implementation log — Manual break start and transition sounds

Entries are append-only, newest at the bottom. One entry per Ralph iteration.

---

## born-paused-break — 2026-06-03

**Status at end of iteration:** in-progress (implementation complete on disk; **could not commit or run the feedback loop — see Blocker**)

**What was implemented**

The state module's phase-advance routine now creates the post-focus break **born paused** at the focus-completion moment instead of auto-starting it running.

- `apps/cli/src/state.ts` — in `advancePhaseIfExpired`, the focus→break transition now writes the break record with `pausedAt: completedAt` (was `null`). Because a paused phase never derives as `expired`, the chained-expiry `while` loop re-reads the new record, sees `kind: "paused"`, and returns without advancing the pending break. `deriveState` already yields `remainingMs = nominalEnd − pausedAt = durationMs`, i.e. the full break duration, stable arbitrarily long after expiry — no `deriveState` change needed. No new state kind; consumers (status, TUI `derivePhaseState`, serve) render the pending break as a paused break with zero changes, per the PRD.

**Tests (red/green reasoning — see Blocker re: execution)**

- `apps/cli/src/__tests__/state.test.ts`:
  - Rewrote "expired focus → break …" to assert the break is born paused at the completion moment (`pausedAt === 1000`) with full short-break duration remaining via `deriveState`.
  - Added "remaining time is stable arbitrarily long after focus expiry" (paused, full duration a day later).
  - Added "chained-expiry loop does not advance a pending break to idle" (replaces the old break-also-expired→idle case, which encoded auto-start).
  - Added "a resumed pending break that expires clears to idle, no break completion logged".
  - Strengthened the long-break case to assert `pausedAt === 1000` (long break also born paused).
- `apps/cli/src/__tests__/status.test.ts` — the expired-focus advance test now asserts `state: "paused"`, `phase: "break"`, full `remainingMs`, matching the slice's outside-in (`pmdr status --json` minutes after expiry reports a paused break with full remaining).
- `apps/cli/src/__tests__/pause-resume-stop.test.ts` — reconciled two tests that encoded auto-start: pausing the now-paused break throws `already paused`; resume succeeds (resume is the start affordance, works with zero command-code change since born-paused reuses the paused mechanism).
- `apps/cli/src/__tests__/start.test.ts` — reconciled two tests: `start` still refuses while a break is pending (now via the `paused` guard, not `already running`); a long-expired focus lands in a pending break rather than auto-expiring to idle.
- `apps/cli/src/__tests__/today.test.ts`, `apps/cli/src/__tests__/log-with-project.test.ts` — comment-only corrections (assertions already pass under born-paused).

**Self-verification performed (no shell available)**

- `pausedAt: completedAt` is type-consistent (`number`); no new symbols introduced; `deriveState` already imported where newly used.
- Verified the loop terminates (paused ≠ expired) and the remaining-time arithmetic by hand for short and long breaks.
- Confirmed every consumer (`status.ts`, `tui/phase-state-machine.ts`, `serve.ts`) derives paused state correctly without modification.
- Swept all `apps/cli/src/__tests__/*` for assertions of a *running* break after a focus advance and reconciled each.

**Blocker (why this iteration could not finish)**

The Bash tool is unavailable for the entire session: every invocation (and any write to the `.claude-infinum` tree) fails at the harness level with `EPERM: operation not permitted, mkdir '/Users/arielbk/.claude-infinum/session-env/<id>'`. Consequently this iteration could **not**:

- run the feedback loop (`vitest` / typecheck / lint), and
- `git add` / `git commit`.

File edits via the Read/Edit/Write tools work normally, so the implementation above is on disk and complete. Because no iteration can commit or verify while the sandbox denies writes to `…/.claude-infinum/session-env/`, this needs a human to fix sandbox permissions (or commit manually). The slice is left `in-progress` so a future working iteration can reclaim it, run the tests, and commit. Emitting STUCK to halt the loop and surface the infra failure.

## `born-paused-break` — 2026-06-03 15:13:26

**Status:** done
**Summary:** Reclaimed the prior iteration's on-disk implementation (focus→break transition writes `pausedAt: completedAt` in `advancePhaseIfExpired`) and ran the feedback loop it couldn't: full vitest suite, typecheck. Fixed one TS narrowing error in `status.test.ts` (union-typed `StatusResult` accessed without narrowing → switched to `toMatchObject`, matching file idiom).
**Deviations:** none from the plan. Two pre-existing failures on clean `main`, unrelated to this slice and left alone: `help-overlay.test.tsx` (copy assertion "quit / detach (timer keeps running)") and `apps/cli`'s `lint` script (no ESLint config exists in the package, ESLint 9 requires `eslint.config.js`).
**Handoff:** Suite: 302 passed, 1 pre-existing failure (help-overlay). `tsc --noEmit` clean. Born-paused reuses `state: "paused", phase: "break"` — no new state kind; `resume`/`pause`/`start` guards work unchanged (the next slice verifies the flows explicitly). Six test files were reconciled to the new contract — see the prior entry for the per-file rationale.

## `menubar-sounds-and-copy` — 2026-06-03 15:22:43

**Status:** done
**Summary:** Added `SoundPlaying` protocol and `NSSoundPlayer` production conformer to `PhaseNotifier.swift`; `PhaseNotifier` now accepts an optional `soundPlayer` (default `nil`) and plays `SoundName.glass` ("Glass") on focus→break and `SoundName.submarine` ("Submarine") on break→idle. Notification body for focus→break changed from "Break started" to "Break ready". `AppDelegate` wires in `NSSoundPlayer()`. `PhaseNotifierTests` gained 5 new cases: break-ready copy, born-paused break fires notification, Glass on focus→break, Submarine on break→idle, no sound on stop-during-focus, nil player doesn't crash. All 13 `PhaseNotifierTests` pass; two pre-existing `FloatingTimerPanelControllerTests` failures are unrelated and pre-date this branch.
**Deviations:** `RecordingSoundPlayer` test fake implemented as `final class` with `@unchecked Sendable` rather than an `actor`, because the `SoundPlaying` protocol requires a `nonisolated` synchronous `play` method and Swift's concurrency checker rejects actor-isolated conformance to it.
**Handoff:** `SoundName` is a caseless enum namespace on `PhaseNotifier` (public). `NSSoundPlayer.play(named:)` dispatches to `DispatchQueue.main` because `NSSound.play()` requires a main-thread call. The `soundPlayer` parameter is optional (`nil` default) so existing non-sound call sites don't break. Pre-existing failures: `FloatingTimerPanelControllerTests` (2 cases, position storage) — not caused by this slice.

## `cli-flows-pending-break` — 2026-06-03 15:17:24

**Status:** done
**Summary:** CLI flows on a pending break, TDD'd in three behaviours: (1) resume-from-pending shifts the nominal end — the 10s spent pending lands in `accumulatedPauseMs`, so the full break duration runs from the resume moment (green immediately; resume's generic pause accounting already did this — test pins the contract); (2) `initTimer` gained a `force` option that advances-then-clears, so `start --force` replaces a pending break while keeping the focus completion logged — the command's inline force block now routes through it; (3) the foreground countdown's expired branch prints via new exported `countdownCompleteMessage()`: "Break ready — press space in the TUI or run `pmdr resume` to start it" when a pending break exists, plain "Pomodoro complete!" otherwise (idle).
**Deviations:** none.
**Handoff:** Force ordering matters: `advancePhaseIfExpired` runs *before* `clearState` inside `initTimer` so an expired focus still logs its completion before the pending break is discarded. TUI space needs no change — it routes through the same `resumeTimer`. Suite: 307 passed + the pre-existing `help-overlay` failure; `tsc --noEmit` clean.
