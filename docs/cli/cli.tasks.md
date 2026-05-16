# pmdr CLI

Vertical slices for shipping the v1 `pmdr` CLI as `apps/cli`: scaffold + Citty, a state-file core, and the six commands (`start`, `pause`, `resume`, `stop`, `status`, `today`).

## Slices

### `scaffold` — apps/cli with Citty wired

**Status:** done

**Outside-in:** `pmdr --help` prints the six command names with one-line descriptions.

**Feedback loop:** Manual: from the repo root, `pnpm --filter cli build && pnpm --filter cli exec pmdr --help` lists `start`, `pause`, `resume`, `stop`, `status`, `today`. `pmdr --version` prints the package version.

**Human checkpoint:** no

**Depends on:** none

---

### `state-module` — state file + derivation + lazy completion

**Status:** not-started

**Outside-in:** A module exposing `readState()`, `writeState(s)`, `clearState()`, `deriveState({ file, now })` → `{ kind: "idle" | "running" | "paused" | "expired", remainingMs }`, `appendCompletion({ completedAt, durationMs })`, and `finalizeIfExpired(now)` that consumes any expired record into the log and clears the state file.

**Feedback loop:** Unit tests covering: (1) `deriveState` table — idle, running, paused, expired across boundary timestamps; (2) pause math — paused X ms then resumed shifts the nominal end by X ms via `accumulatedPauseMs`; (3) `finalizeIfExpired` is idempotent on already-cleared state and writes exactly one log entry when called on an expired record; (4) atomic write — partial writes don't corrupt the file (temp + rename).

**Human checkpoint:** no

**Depends on:** scaffold

---

### `start-command` — `pmdr start [--duration N]`

**Status:** not-started

**Outside-in:** `pmdr start` begins a 25-minute pomodoro and renders a live countdown. `pmdr start --duration 10s` (or similar short form) begins a shorter pomodoro for testing. Errors if a timer is already running or paused.

**Feedback loop:** Manual: `pmdr start --duration 5s` shows a ticking countdown for ~5 seconds, fires a terminal bell, exits, and the completion appears in the log file on disk. While running in T1, inspecting `~/.local/state/pmdr/state.json` from T2 shows a well-formed record. Closing T1 mid-run leaves the state file in place.

**Human checkpoint:** no

**Depends on:** state-module

---

### `status-command` — `pmdr status [--json]`

**Status:** not-started

**Outside-in:** `pmdr status` prints a human line like `running — 18:42 left` / `paused — 18:42 left` / `idle`. `pmdr status --json` prints `{ state, remainingMs, duration, startedAt }` (or `{ state: "idle" }`).

**Feedback loop:** Manual two-terminal: start a timer in T1, run `pmdr status` and `pmdr status --json` in T2 — both reflect the running state. After T1's timer hits zero (or a fake expired state is written), `pmdr status` in T2 shows `idle` *and* appends a completion to the log (the lazy-completion path).

**Human checkpoint:** no

**Depends on:** state-module

---

### `pause-resume-stop` — three mutating commands

**Status:** not-started

**Outside-in:** `pmdr pause`, `pmdr resume`, `pmdr stop`. Each prints a short human confirmation. `pause` on an idle or already-paused timer errors. `resume` on a running or idle timer errors. `stop` on idle is a no-op.

**Feedback loop:** Manual two-terminal: start in T1, `pmdr pause` in T2 — T1's countdown freezes within ~1s. `pmdr resume` in T2 — T1's countdown resumes from the same value. `pmdr stop` in T2 — T1's renderer exits cleanly. A stopped pomodoro does NOT appear in `pmdr today` / log.

**Human checkpoint:** no

**Depends on:** start-command, status-command

---

### `today-command` — `pmdr today [--json]`

**Status:** not-started

**Outside-in:** `pmdr today` prints `N pomodoros today` followed by the local-time list of completion timestamps. `pmdr today --json` prints `{ count, completions: [{ completedAt, durationMs }, ...] }`.

**Feedback loop:** Manual: append a few completions to the log file with timestamps spanning today / yesterday / tomorrow boundary, run `pmdr today`, confirm only today's entries are counted (local-date boundary, not UTC). `--json` shape matches.

**Human checkpoint:** no

**Depends on:** state-module
