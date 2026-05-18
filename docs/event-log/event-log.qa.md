# Event Log Feature — QA Plan

Automated checks already in CI: `pnpm --filter cli test` (257 tests) + `pnpm --filter cli check-types`. The walkthrough below is for the parts the harness can't observe — real wall-clock pomodoros, the TUI rendering on your terminal, and the new `events.jsonl` artefact.

> All paths below assume the default state directory: `~/.local/state/pmdr/`.

## 1. Late-binding project attribution

1. `pmdr stop` to clear any leftover state.
2. `pmdr start` (no `--project`, in a real TTY).
3. **Expect:** the timer starts immediately, no project picker.
4. `pmdr status --json` → `project: "(unassigned)"` (or the field absent / default).
5. Inside the TUI press `p`, pick or create a project named `qa-late-bind`.
6. Let the focus block expire (or temporarily lower duration: re-run with `--duration 30s`).
7. `tail -1 ~/.local/state/pmdr/completions.jsonl` → `project: "qa-late-bind"`, **not** `(unassigned)`.

## 2. Per-timer uuid (slice `pomodoro-id`)

1. `pmdr stop`, then `pmdr start --duration 30s --project qa-id --no-interactive` (or in TTY without flag).
2. `cat ~/.local/state/pmdr/state.json | jq .id` → uuid v4.
3. Wait for expiry, then `tail -1 ~/.local/state/pmdr/completions.jsonl | jq .id` → **same** uuid.
4. Start a second timer; confirm the new `state.json` `id` differs from the previous completion's `id`.
5. Manually edit `state.json` to remove the `id` field; `pmdr status --json` must not throw — legacy state is tolerated.

## 3. Append-only events log (slice `event-log-emission`)

1. `rm -f ~/.local/state/pmdr/events.jsonl`.
2. `pmdr start --duration 5m --project qa-events --no-interactive` in one terminal.
3. In another terminal: `pmdr pause`, then `pmdr resume`, then `pmdr stop`.
4. `cat ~/.local/state/pmdr/events.jsonl` should show **exactly four** rows in order:
   - `{"type":"start", ...}`
   - `{"type":"pause", ...}`
   - `{"type":"resume", ...}`
   - `{"type":"stop", ...}`
5. All four rows share the same `id`.
6. `pmdr start --duration 30s --project qa-events --no-interactive`; let it expire.
7. `tail ~/.local/state/pmdr/events.jsonl` → only a new `start` row (no `stop` from expiry); the new completion is in `completions.jsonl` instead.

## 4. TUI dot row reflects today's completions (slice `dots-from-completions`)

1. Stop any timer.
2. Complete two short focus blocks (e.g. `pmdr start --duration 5s --project qa-dots --no-interactive`, wait 6s, repeat). Each completion appends to `completions.jsonl`.
3. Launch the TUI: `pmdr` with no subcommand.
4. **Expect:** two filled green dots `●` and six empty `○`. **No** `2/8` fraction next to them.
5. Press `x` to stop the auto-started timer if needed, escape out, then re-launch the TUI — the count should still show two filled dots because it reads from `completions.jsonl`, not the now-cleared `state.json`.
6. Push the count to ≥ 9 completions in one day to confirm the cap: dots stop at 8 filled, no overflow.

## 5. pmdr-cli skill backdating (slice `skill-backdating-doc`) — **human review required**

This slice's feedback loop is human review per the PRD. Open `skills/pmdr-cli/SKILL.md` and confirm:

- The `Backdating` section reads unambiguously to an agent who has never used `pmdr`.
- The formula `--duration = default_focus_minutes − N` is correct and worked examples (N=5 → 20m, N=10 → 15m) line up.
- The "do not exceed default focus length" rule is explicit, plus the N≥25 edge case.

If anything is unclear, edit the section and re-commit before merging.

## Regression checks

- `pmdr status --json` on idle still returns `{ "state": "idle" }`.
- `pmdr today --json` keeps working with mixed legacy rows (no `id`) and new rows (with `id`).
- Existing project rename / archive flows are unchanged.

## Known non-blockers

- `pnpm --filter cli lint` still fails because the package's `lint` script invokes `eslint src` but there is no ESLint 9 flat config in `apps/cli/`. This is pre-existing and unrelated to this branch.
- A handful of pre-existing Ink-rendering tests show ANSI-color diffs in some terminals; on this branch they pass.
