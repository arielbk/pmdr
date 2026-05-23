# pmdr menubar

Native macOS menubar app for [pmdr](../cli). Thin shell over the CLI: reads via `pmdr status --json`, writes via shelling out to `pmdr`.

Lives outside the Turbo pipeline — separate Xcode toolchain.

## Requirements

- macOS 13+
- Xcode 15+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`

## Run

From the repo root:

```sh
pnpm menubar       # build Debug and launch pmdr.app
pnpm menubar:gen   # regenerate pmdr-menubar.xcodeproj after editing project.yml
```

These wrap [`scripts/menubar-run.sh`](../../scripts/menubar-run.sh) and [`scripts/menubar-gen.sh`](../../scripts/menubar-gen.sh). The run script generates the project on first use, builds Debug, kills any running `pmdr` menubar instance, and launches the freshly built `.app` — no Xcode UI needed.

If `xcodebuild` fails to load a plug-in (e.g. `IDESimulatorFoundation`, common after an Xcode update), run `xcodebuild -runFirstLaunch` once to install missing components, then retry.

To work in Xcode instead:

```sh
pnpm menubar:gen
open apps/menubar/pmdr-menubar.xcodeproj
```

The app is configured with `LSUIElement = true`, so it appears only in the menubar — no Dock icon, no main window. Click the `pmdr` item in the menubar and choose **Quit** (⌘Q) to terminate.

## Layout

```
apps/menubar/
├── project.yml                  # XcodeGen spec — generates pmdr-menubar.xcodeproj
├── Resources/
│   └── Info.plist               # LSUIElement = true (menubar-only app)
├── Sources/
│   ├── main.swift               # app entry point, installs AppDelegate
│   ├── AppDelegate.swift        # NSStatusItem + menu, drives the poller + tick timer
│   ├── HotkeyManager.swift      # global Ctrl+Option+Command+P registration
│   └── PmdrMenubarCore/         # framework consumed by the app + tests
│       ├── LoginShellEnvironment.swift # resolves user login-shell PATH for CLI subprocesses
│       ├── PhaseNotifier.swift  # maps poller events to native banners (focus end, break end)
│       ├── PmdrClient.swift     # typed Swift client for the `pmdr` CLI
│       ├── StatusPoller.swift   # actor that polls PmdrClient + emits change/phase events
│       └── TitleFormatter.swift # pure Status → "M:SS" / "" formatter
└── Tests/
    └── PmdrMenubarCoreTests/    # XCTest bundle for PmdrMenubarCore
```

The generated `pmdr-menubar.xcodeproj` is git-ignored — regenerate with `xcodegen generate` after changing `project.yml`.

## Tests

Unit tests live under `Tests/PmdrMenubarCoreTests/` and run via the `pmdr-menubar` scheme:

```sh
xcodebuild -scheme pmdr-menubar -destination 'platform=macOS' test
```

Integration tests that shell out to the real `pmdr` binary are gated behind `PMDR_INTEGRATION=1` and require `pmdr` on PATH:

```sh
PMDR_INTEGRATION=1 xcodebuild -scheme pmdr-menubar -destination 'platform=macOS' test
```
