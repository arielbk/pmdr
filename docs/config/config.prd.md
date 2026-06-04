# PRD: Config

## Resources

- Scope decisions: `/Users/arielbk/.trace/tasks/8d283634-492d-45e4-b4a6-43ab9cb72379/docs/scope.md` (Trace task `config`; this session is bound to it — keep task docs there current as decisions evolve).

## Problem Statement

Every tunable in pmdr is a hardcoded constant: the 25-minute focus block, the 5/15-minute short/long breaks, the every-4th-block long-break cadence, and the Glass/Submarine phase-end sounds. The duration defaults are duplicated across the CLI start command, the state module's break computation, the TUI, and the menubar's optimistic start prediction. A user who wants 50-minute focus blocks, a different break rhythm, or different sounds has no recourse short of editing source — and the sound constants were explicitly left as a hook for exactly this configurability pass.

## Solution

A single config file — `~/.config/pmdr/config.json` — owned by the CLI, covering durations (focus, short break, long break, long-break cadence) and the two phase-end sounds. The file is entirely optional: every key falls back to today's built-in defaults, so a fresh machine behaves exactly as before. A new `pmdr config` subcommand reads and writes it; per-invocation CLI flags (e.g. `pmdr start 50`) still win over config for that session.

The menubar gains a standard macOS Settings window (⌘,): number fields for the four duration values and two dropdowns of macOS system sounds that play the sound on selection — so picking a sound *is* previewing it. The window never touches the file; it reads effective values from the CLI and writes through `pmdr config set`, the same thin-client pattern as every other menubar mutation. Config changes apply from the next block onward; a running block is never resized.

## User Stories

1. As a user whose rhythm isn't 25/5, I want to set my own focus and break durations once, so that every session — CLI, TUI, or menubar — uses them without per-invocation flags.
2. As a user who prefers a different long-break rhythm, I want to configure the long-break duration and how many focus blocks trigger it, so that the existing every-4th-block behaviour matches how I actually work.
3. As a menubar user, I want a Settings window opened from the menu (⌘,), so that I can change durations and sounds without touching a terminal or a JSON file.
4. As a user picking notification sounds, I want each sound to play the moment I select it in the dropdown, so that I can click through candidates and choose by ear.
5. As a user on a fresh machine with no config file, I want pmdr to behave exactly as it does today, so that config is pure opt-in and nothing breaks.
6. As a user starting a one-off long session, I want `pmdr start 50` to override my configured focus duration for that session only, so that flags stay the sharpest tool.
7. As a user who edits the JSON by hand, I want malformed JSON or invalid values (non-positive numbers, unknown sound names) to produce a warning and per-key fallback to defaults, so that a typo never crashes or bricks the timer.
8. As a user mid-focus-block when I change a duration, I want the running block left untouched and the new value applied from the next block, so that the timer I'm watching never jumps.
9. As a scripting user, I want `pmdr config get`/`set` and a `--json` dump of effective config, so that I can inspect and automate settings the same way I script everything else.
10. As a menubar user who edited config from the terminal, I want the menubar's predicted durations and sounds to pick up the change, so that the two surfaces never disagree about what the next block looks like.

## Implementation Decisions

- **Config module (CLI, the deep module).** A new module owns everything about config: XDG path resolution (`~/.config/pmdr/config.json` — config is user intent, deliberately separate from the `~/.local/state/pmdr/` state dir), parsing, per-key validation, merging with built-in defaults, and atomic temp-file-then-rename writes (the established pattern). Its interface exposes *effective* config — callers never see raw-file concerns. Missing file, missing keys, malformed JSON, and invalid values all resolve inside it: warn on stderr, fall back per key, never throw. Unknown keys are ignored for forward compatibility.
- **Schema.** Flat, minutes for hand-editability: `focusMinutes`, `shortBreakMinutes`, `longBreakMinutes`, `longBreakEvery`, and `sounds: { focusEnd, breakEnd }` holding macOS system sound names. Defaults equal today's constants (25, 5, 15, 4, Glass, Submarine). Sound values are name strings; a path-shaped string can mean a custom file in a later pass without a schema change.
- **Precedence.** CLI flag > config file > built-in default. The start command's explicit duration argument keeps winning for that session.
- **`pmdr config` subcommand.** `get [key]`, `set <key> <value>`, and a `--json` dump of effective (merged) config. `set` validates before writing and is the single write path for all surfaces.
- **Wiring.** The start command's default duration, the state module's break computation (short vs long and the every-Nth cadence — the logic already exists; only its constants become configurable), and the TUI default all read effective config instead of local constants.
- **Menubar config client.** The menubar fetches effective config via `pmdr config --json` on launch and after each settings edit, and writes via `pmdr config set` — it never reads or writes the JSON file itself (one writer, one parser). The hardcoded 25-minute optimistic start prediction is replaced by the effective focus duration.
- **Settings window.** A standard Settings window opened from a menu item with ⌘,. Four number fields (focus, short break, long break, long-break cadence) and two dropdowns enumerating macOS system sounds, playing the selection immediately as the preview. Each committed change shells out to `pmdr config set`. Input controls constrain values to valid ranges, so the window can't produce input the validator would reject.
- **PhaseNotifier.** Sound names are injected from effective config instead of the existing named constants; the constants become the defaults inside the config module. The injectable sound-player seam is unchanged.
- **Effect timing.** Durations are stamped into the session record at block start (already the case), so config changes naturally apply from the next block; no live-resize logic anywhere.

## Testing Decisions

- **Config module (vitest, the bulk of the risk):** missing file yields defaults; partial file merges per key; malformed JSON warns and yields defaults; invalid values (zero, negative, wrong type, unknown sound name) warn and fall back individually while valid sibling keys apply; set-then-get round-trips through an atomic write; unknown keys survive a read-modify-write cycle.
- **Config command flows:** `get`/`set`/`--json` against a temp config dir; `set` rejects invalid values without writing.
- **Wiring (extend existing suites):** start uses configured focus duration when no flag is given and the flag when it is; break computation uses configured short/long durations and cadence (e.g. `longBreakEvery: 2` produces a long break after the 2nd block).
- **Menubar core (Swift, existing seam patterns):** config JSON decoding including missing/partial payloads; PhaseNotifier plays the configured sound names rather than the old constants.
- **Settings window:** no automated UI tests — covered by the QA plan.

## Out of Scope

- Key-binding configurability or rebinding UI — the two global hotkeys stay hardcoded; even a config-file escape hatch is a follow-up.
- Custom sound files — system sounds only (the schema leaves room).
- Menu-submenu settings — rejected in favour of the window (submenus fight sound preview).
- Resizing a running block when config changes.
- Watching the config file for live changes — the menubar refreshes on launch and after its own edits; sub-second cross-surface sync is not a goal.
- Any new configurable beyond the six keys (notification copy, poll cadence, state-dir location, etc.).
