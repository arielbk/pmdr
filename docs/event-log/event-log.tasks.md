# Event Log & Late Project Attribution

Adds an append-only `events.jsonl` capturing start/stop/pause/resume with per-timer uuids, makes project assignment late-binding (picker no longer forced at start), and fixes the TUI focus-block dots so they accumulate across the day. Backdating is handled in the pmdr-cli skill, not in code.

## Slices

### `late-project-attribution` — Late-binding project attribution

**Status:** done

**Outside-in:** `pmdr start` (no `--project`, interactive TTY) starts a timer immediately without prompting; the active record's project is `(unassigned)` until the user changes it via the existing `p` command, and the completion row uses the project at expiry.

**Feedback loop:** Unit/integration tests: (a) `pmdr start` with no `--project` in interactive mode succeeds and writes `project: "(unassigned)"`; (b) a record whose project is mutated between start and expiry produces a completion carrying the *new* project.

**Human checkpoint:** no

**Depends on:** none

---

### `pomodoro-id` — Per-timer uuid

**Status:** done

**Outside-in:** `state.json` and every row in `completions.jsonl` carry a stable `id` (uuid v4) generated at `pmdr start`. The id survives pause/resume and phase transitions, and the completion row's id matches the `start` event's id.

**Feedback loop:** Unit tests: (a) `pmdr start` writes a record with a uuid-shaped `id`; (b) the completion row written at expiry has the same `id` as the source record; (c) reading a legacy `state.json` without `id` does not throw.

**Human checkpoint:** no

**Depends on:** none

---

### `event-log-emission` — Append-only event log

**Status:** done

**Outside-in:** `~/.local/state/pmdr/events.jsonl` receives one JSONL row per timer event. Each row: `{ type: "start" | "stop" | "pause" | "resume", at: <epoch ms>, id: <uuid>, project?: string }`. `start` fires from `pmdr start`; `pause`/`resume` fire from those commands; `stop` fires only when a timer is cleared without completing. Expiry writes a completion, not a `stop`.

**Feedback loop:** Integration test against a real temp directory: drive a timer through start → pause → resume → stop, then assert `events.jsonl` contains exactly those four rows in order, all sharing the same `id`. A separate test drives start → expiry and asserts no `stop` event is written.

**Human checkpoint:** no

**Depends on:** pomodoro-id

---

### `dots-from-completions` — TUI dots fill across the day

**Status:** not-started

**Outside-in:** The interactive TUI's focus-block dot row reflects today's completed focus blocks read from `completions.jsonl`, capped visually at 8 dots. The "x/8" fraction next to the dots is removed.

**Feedback loop:** Component/unit test using a fixture `completions.jsonl` with N entries dated today: assert the rendered dot row shows N filled dots (up to 8) and 0 trailing fraction text. Also assert the count persists across a simulated focus → break → focus phase transition (the live bug).

**Human checkpoint:** no

**Depends on:** none

---

### `skill-backdating-doc` — pmdr-cli skill documents backdating

**Status:** not-started

**Outside-in:** `skills/pmdr-cli/SKILL.md` contains a short section telling agents: when the user says "I started N minutes ago," run `pmdr start --duration (default − N)m` so the completion lands at the right wall-clock time, and do not exceed the default focus length.

**Feedback loop:** Human review: the skill file reads clearly to an agent who has never run pmdr before; the rule and the formula are unambiguous.

**Human checkpoint:** yes

**Depends on:** none
