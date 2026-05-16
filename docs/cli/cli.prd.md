# PRD: pmdr CLI

## Problem Statement

I want a pomodoro timer I can drive from the terminal during focus work. It needs to survive across terminal sessions (closing a terminal must not lose the timer), be controllable from any terminal (pause from one, started in another), and expose its state in a machine-readable form so agents and future surfaces (web server, Slack, Discord) can observe what I'm doing without ad-hoc parsing.

## Solution

A single CLI binary `pmdr`, shipped as `apps/cli` in this Turborepo, with six commands: `start`, `pause`, `resume`, `stop`, `status`, `today`. State lives on disk as the single source of truth — every command is a pure read or mutation of a state file, and `start` runs in the foreground as a renderer that polls that file. Closing the terminal does not destroy the timer; it only stops the local countdown display. `status --json` makes the timer observable to agents and future consumers.

## User Stories

1. As a user, I want to run `pmdr start` and see a live countdown in my terminal, so I know how much focus time is left without checking elsewhere.
2. As a user, I want to pass `--duration N` to `start`, so I can override the default 25-minute pomodoro when I want a different length.
3. As a user, I want `pmdr pause` to pause a running timer and `pmdr resume` to resume it, so I can step away without losing the pomodoro.
4. As a user, I want `pmdr stop` to cancel the current timer, so I can abandon a pomodoro cleanly. A stopped pomodoro is not logged.
5. As a user, I want `pmdr status` to show whether a timer is running, paused, or idle, and how much time is left, so I can check state at any moment.
6. As a user in a second terminal, I want pause/resume/stop to affect the timer that's rendering in the first terminal, so I'm not locked to one shell.
7. As a user, I want the foreground `pmdr start` countdown to reflect pause/resume/stop issued from another terminal within ~1 second, so the display stays honest.
8. As a user, I want the timer to keep "running" on disk even if I close the terminal that launched it, so I don't lose a pomodoro to a window I closed.
9. As a user, I want a desktop notification (or terminal bell) when a foreground `pmdr start` reaches zero, so I notice the pomodoro ended without watching the screen. If no foreground process is alive at zero, no notification fires — this is acceptable for v1.
10. As a user, I want `pmdr today` to show how many pomodoros I completed today and at what times, so I can see my focus output for the day.
11. As an agent or external tool, I want `pmdr status --json` and `pmdr today --json` to return structured output, so I can read the user's focus state programmatically without parsing human-formatted text.
12. As a user, I want a completed pomodoro to be recorded even if I closed the foreground terminal before it hit zero, so accidental terminal closure doesn't cost me credit for work I did.

## Implementation Decisions

**Package layout.** No separate `core` package for v1. All logic lives inside `apps/cli`. The Turborepo gives us the *option* to extract a `packages/core` later when a second consumer (web server, Slack bot) actually exists; extracting now would design the wrong abstraction.

**CLI framework.** Citty (UnJS) for arg parsing, subcommand routing, and `--help` generation. Gunshi was considered and rejected as more framework than needed for six commands with no i18n or plugin requirements.

**State file.** `~/.local/state/pmdr/state.json` is the single source of truth. Shape: `{ startedAt: ISO8601, duration: ms, pausedAt: ISO8601 | null, accumulatedPauseMs: number }`. Absent file ⇒ idle state. Reads and writes are atomic (write to temp file, rename). XDG state dir honoured on Linux; the same path works on macOS.

**Derived state.** Running/paused/completed/idle is computed from the file plus wall-clock `now`. There is no `state: "running"` field — it's derived. A record where `now > startedAt + duration - accumulatedPauseMs` and `pausedAt === null` is considered *expired* and triggers the lazy completion transition.

**Lazy completion.** Any command that reads the state file and observes an expired record (1) appends a completion entry to the log, (2) clears the state file, (3) proceeds with its own logic. This means `pmdr status` run after the timer's nominal end still credits the pomodoro. This is the mechanism that makes story 12 work without a daemon.

**Log file.** `~/.local/state/pmdr/log.jsonl`, append-only. One JSON object per line: `{ completedAt: ISO8601, durationMs: number }`. No tags, no project, no stopped/abandoned entries. `pmdr today` filters by local-date.

**Foreground renderer.** `pmdr start` writes the initial state, then enters a render loop that polls the state file every ~1s and redraws. If it observes the state cleared from underneath it (stop from another terminal), it exits cleanly. If it observes `pausedAt` set, it freezes the display. If it reaches the zero mark itself, it appends to the log, clears the state file, fires a notification, and exits.

**Notifications.** Terminal bell (`\x07`) is the v1 default. A richer notifier (e.g. `node-notifier`) can be added later but is not required for the done condition.

**Mutating commands.** `pause`, `resume`, `stop` are pure state-file mutations. They print a short human-readable confirmation and exit. They do not support `--json` in v1.

**`status` and `today`.** Both support `--json`. Human output is concise; JSON output is the contract surface for agents.

**Modules inside `apps/cli`.** Even without a separate package, the code naturally splits into:

- `state` — read/write/atomic-rename of the state file, plus pure functions that derive current state from `{ file, now }`.
- `log` — append a completion, read today's entries.
- `lazy-completion` — the "observe expired, finalize, clear" transition. Called at the top of every command.
- `commands/*` — one file per Citty command, thin wrappers over the modules above.
- `render` — the foreground countdown loop for `start`.

These are module boundaries, not package boundaries. Everything stays under `apps/cli/src`.

## Testing Decisions

The valuable tests target pure derivation and the state-file contract. The render loop and notification path are not unit-tested.

- **State derivation.** Given a state-file shape and a fixed `now`, assert the derived state (running, paused, expired, idle) and remaining ms. Pure function, easy table-driven tests.
- **Lazy completion transition.** Given an expired state file, calling the transition appends one log entry and clears the state file. Idempotent on already-cleared state.
- **Pause/resume math.** A timer paused for X ms then resumed must end X ms later than its original nominal end. Verify `accumulatedPauseMs` is applied correctly to remaining-time math.
- **Log filtering.** `today` filters entries by the local-date boundary, not UTC.

The foreground renderer, Citty wiring, notifications, and actual filesystem atomicity are out of scope for unit tests in v1. Manual verification against the done condition (two-terminal interaction) covers the integration path.

## Out of Scope

- Separate `packages/core` extraction.
- Background daemon or any process that outlives the foreground `start`.
- Cross-terminal desktop notifications when no foreground process is alive at the zero mark.
- Break timers, auto-cycling work→break→work.
- Configuration file. The only configurable knob is `--duration` on `start`.
- Projects, tags, or any metadata on pomodoros beyond duration and completion time.
- Historical stats beyond `today` — no weekly, no streaks, no queries.
- Records of stopped or abandoned pomodoros.
- `--json` on mutating commands (`start`, `pause`, `resume`, `stop`).
- Web server, Slack integration, Discord integration. These are explicitly future apps in the Turborepo, each a separate consumer of the same state file.
- Multi-user / multi-machine sync.

## Open Questions

- Binary name: confirmed as `pmdr`. Bin entry in `apps/cli/package.json` should expose this.
- Should `pmdr` with no subcommand alias to `status`? Convenient, but Citty's default behaviour is to print help. Lean: keep Citty default for v1, no alias.
- Lockfile semantics on the state file: do we need a file lock to prevent two simultaneous mutations from racing (e.g. `pause` and `stop` issued at the same instant from different terminals)? Atomic rename makes last-writer-wins acceptable for v1, but worth noting if it surfaces in testing.
