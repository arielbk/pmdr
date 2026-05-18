# pmdr menubar

Native macOS menubar app for [pmdr](../cli). Thin shell over the CLI: reads via `pmdr status --json`, writes via shelling out to `pmdr`.

Lives outside the Turbo pipeline — separate Xcode toolchain.

## Requirements

- macOS 13+
- Xcode 15+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`

## Run

```sh
cd apps/menubar
xcodegen generate
open pmdr-menubar.xcodeproj
```

Hit Run in Xcode. Or build & launch headless:

```sh
xcodebuild -scheme pmdr-menubar -configuration Debug build
open "$(xcodebuild -scheme pmdr-menubar -configuration Debug -showBuildSettings | awk -F' = ' '/ BUILT_PRODUCTS_DIR /{print $2}')/pmdr.app"
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
│   └── PmdrMenubarCore/         # framework consumed by the app + tests
│       ├── LoginShellEnvironment.swift # resolves user login-shell PATH for CLI subprocesses
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
