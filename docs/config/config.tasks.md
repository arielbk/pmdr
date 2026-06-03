# Config

A CLI-owned config file (`~/.config/pmdr/config.json` + `pmdr config get/set`) for durations, long-break cadence, and phase-end system sounds, plus a menubar Settings window with sound preview that reads/writes through the CLI. See `config.prd.md` for full decisions.

## Slices

### `config-read` — Config module and read commands

**Status:** done

**Outside-in:** `pmdr config --json` dumps effective (merged) config; `pmdr config get <key>` prints one effective value. Works with no file, a partial file, or a broken file.

**Feedback loop:** Vitest: missing file yields built-in defaults (25/5/15/4, Glass/Submarine); partial file merges per key; malformed JSON warns on stderr and yields defaults; invalid values (zero, negative, wrong type, unknown sound name) warn and fall back individually while valid sibling keys apply; unknown keys ignored.

**Human checkpoint:** no

**Depends on:** none

### `config-set` — Config write command

**Status:** not-started

**Outside-in:** `pmdr config set <key> <value>` validates and persists; `pmdr config get <key>` reflects it afterwards.

**Feedback loop:** Vitest: set-then-get round-trips through an atomic write against a temp config dir; `set` rejects invalid values without writing; unknown keys in the file survive a read-modify-write cycle.

**Human checkpoint:** no

**Depends on:** config-read

### `durations-wiring` — CLI surfaces use effective durations

**Status:** not-started

**Outside-in:** With `focusMinutes: 50` configured, `pmdr start` runs a 50-minute focus block (TUI default matches); `pmdr start 25` still wins for that session; with `longBreakEvery: 2` and configured break durations, the 2nd focus block yields the configured long break.

**Feedback loop:** Vitest, extending the existing start/state suites: start uses configured focus duration when no flag is given and the flag when given; break computation uses configured short/long durations and cadence.

**Human checkpoint:** no

**Depends on:** config-read

### `menubar-config-client` — Menubar reads effective config

**Status:** not-started

**Outside-in:** Menubar fetches `pmdr config --json` on launch; optimistic start prediction shows the configured focus duration instead of the hardcoded 25 minutes; phase-end sounds play the configured names.

**Feedback loop:** Swift tests (existing PmdrMenubarCore seam patterns): config JSON decoding including missing/partial payloads falls back to defaults; PhaseNotifier plays the injected configured sound names rather than the old constants.

**Human checkpoint:** no

**Depends on:** config-read

### `settings-window` — Menubar Settings window

**Status:** not-started

**Outside-in:** "Settings…" menu item (⌘,) opens a window with four number fields (focus, short break, long break, long-break cadence) and two system-sound dropdowns that play the sound on selection; committed changes shell out to `pmdr config set` and the client refetches.

**Feedback loop:** Manual QA: change a duration in the window → `pmdr config get` reflects it and the next block uses it; select a sound → it plays immediately and the next phase end uses it; values edited from the terminal appear in the window on next open. Swift tests cover the client underneath; no automated UI tests.

**Human checkpoint:** yes

**Depends on:** config-set, menubar-config-client
