# QA Plan: Config

## What was built

`pmdr` now has a CLI-owned config file at `~/.config/pmdr/config.json`, with `pmdr config --json`, `pmdr config get`, and `pmdr config set` support for timer durations, long-break cadence, and phase-end system sounds. The CLI and macOS menubar app read the effective config, and the menubar app adds a Settings window for editing and previewing those values.

## Already verified by the agent

These were run during implementation and passed. Listed for confidence, not action.

- [x] `pnpm --filter cli test -- config.test.ts` - config defaults, partial merges, malformed/invalid fallback, get/set round trips, invalid set rejection, and unknown-key preservation passed.
- [x] `pnpm --filter cli test -- start.test.ts state.test.ts status.test.ts project-picker-overlay.test.tsx` - CLI start defaults, explicit duration override, configured break duration/cadence, status, and TUI picker-start coverage passed.
- [x] `pnpm --filter cli check-types` - CLI TypeScript typecheck passed.
- [x] `pnpm --filter cli lint` - CLI lint exited 0, with existing warnings noted outside the config slices.
- [x] `xcrun xctest apps/menubar/DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` - menubar core tests passed for config decoding/client calls, optimistic focus duration, configured phase-end sounds, and Settings save wiring; final run reported 118 tests and 3 integration skips.
- [x] `xcodebuild build -project apps/menubar/pmdr-menubar.xcodeproj -scheme pmdr-menubar -derivedDataPath apps/menubar/DerivedData` - macOS menubar app build passed.

## Human verification required

Items from slices with `Human checkpoint: yes`, plus anything from the log that needs a human eye, browser, device, or judgement call. Each item is a runbook - exact commands, exact entry point, steps, and pass criterion. Never make the human figure out how to run the thing.

The `settings-window` slice is `Status: needs-review`; the loop settled automated coverage, but the native window, audio previews, and runtime sound behavior still require human verification.

### Setup

Commands shared by the items below. Run once from the repo root on macOS with Xcode 15+, XcodeGen, Node 18+, and pnpm 9 installed.

```bash
cd /Users/arielbk/Projects/side/pmdr
pnpm setup
pnpm menubar
```

`pnpm setup` installs, builds, and globally links the `pmdr` CLI. `pnpm menubar` builds Debug, kills any running `pmdr` menubar instance, and launches `pmdr.app`; there is no browser URL or port for this native menubar flow. The app appears only as a `pmdr` item in the macOS menubar.

- [ ] **Settings window saves config values to the CLI-owned config file**
  - Run: use the app from Setup, and keep a terminal open at `/Users/arielbk/Projects/side/pmdr`.
  - Open: click the `pmdr` macOS menubar item and choose `Settings...`, or press Command-comma while the menubar app is active.
  - Do: set `Focus minutes` to `50`, `Short break minutes` to `7`, `Long break minutes` to `20`, and `Long break cadence` to `2`; click `Save`. In the terminal, run `pmdr config get focusMinutes`, `pmdr config get shortBreakMinutes`, `pmdr config get longBreakMinutes`, and `pmdr config get longBreakEvery`.
  - Expect: the Settings window closes without an error alert, and the four commands print `50`, `7`, `20`, and `2` respectively.
- [ ] **Settings sound dropdowns preview audibly and persist selected sounds**
  - Run: use the app from Setup, and keep a terminal open at `/Users/arielbk/Projects/side/pmdr`.
  - Open: click the `pmdr` macOS menubar item and choose `Settings...`.
  - Do: change `Focus end sound` to `Ping` and `Break end sound` to `Pop`; listen when each dropdown selection changes; click `Save`. In the terminal, run `pmdr config get focusEndSound` and `pmdr config get breakEndSound`.
  - Expect: each selected sound plays immediately on selection, the Settings window saves without an error alert, and the commands print `Ping` and `Pop`.
- [ ] **Terminal-edited values appear next time Settings opens**
  - Run: use the app from Setup, and run these commands from `/Users/arielbk/Projects/side/pmdr`:

    ```bash
    pmdr config set focusMinutes 33
    pmdr config set shortBreakMinutes 6
    pmdr config set longBreakMinutes 18
    pmdr config set longBreakEvery 3
    pmdr config set focusEndSound Glass
    pmdr config set breakEndSound Submarine
    ```

  - Open: click the `pmdr` macOS menubar item and choose `Settings...`.
  - Do: inspect the four number fields and two sound dropdowns.
  - Expect: the window shows `33`, `6`, `18`, `3`, `Glass`, and `Submarine`, matching the terminal edits without restarting the app.
- [ ] **Configured focus duration affects the next menubar-started timer block**
  - Run: use the app from Setup, and run these commands from `/Users/arielbk/Projects/side/pmdr`:

    ```bash
    pmdr stop
    pmdr config set focusMinutes 33
    ```

  - Open: click the `pmdr` macOS menubar item.
  - Do: choose `Start` -> `None`; then run `pmdr status --json` in the terminal.
  - Expect: the menubar title shows a timer near 33 minutes, and `pmdr status --json` reports a running focus session with a duration of about 1,980,000 ms.
- [ ] **Configured phase-end sounds are used at runtime**
  - Run: use the app from Setup, and run these commands from `/Users/arielbk/Projects/side/pmdr`:

    ```bash
    pmdr stop
    pmdr config set shortBreakMinutes 1
    pmdr config set focusEndSound Ping
    pmdr config set breakEndSound Pop
    ```

  - Open: click the `pmdr` macOS menubar item.
  - Do: start a very short focus session from the terminal with `pmdr start 1s`, wait for it to roll into the configured 1-minute break, then wait for that break to end.
  - Expect: the focus-to-break transition plays `Ping`, and the break-to-idle transition plays `Pop` within about 70 seconds total.
- [ ] **Invalid Settings values are rejected in the window**
  - Run: use the app from Setup.
  - Open: click the `pmdr` macOS menubar item and choose `Settings...`.
  - Do: enter `0` in any duration or cadence field and click `Save`.
  - Expect: the window stays open and shows an `Invalid settings` alert saying durations and cadence must be positive whole numbers; the saved CLI config remains unchanged.

## Watch closely

Items where the log recorded deviations, snags, or unusual decisions. These are the most likely sources of subtle bugs - worth extra scrutiny during human verification.

- [ ] `config-set` added `apps/cli/eslint.config.mjs` so CLI package lint could run; broader `pnpm --filter cli test` still fails on unrelated existing TUI/help snapshot/color assertions outside this feature.
- [ ] `menubar-config-client` and `settings-window` could not use normal `xcodebuild test` under the sandbox because it could not attach to `testmanagerd`; the bundle was run directly with `xcrun xctest` instead.
- [ ] `settings-window` is intentionally `needs-review` because it is a human checkpoint with no automated UI tests; prioritize the Settings save/refetch/audio behavior above.
