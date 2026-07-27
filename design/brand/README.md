# pmdr tomato

The pmdr mark is a wide, squat tomato with visible bottom lobes, an oversized
star-like calyx, and two short rib lines. Those details keep the silhouette
recognizable across the terminal, README, and native macOS surfaces without
letting it read as an apple or pumpkin.

`scripts/generate-brand-assets.mjs` is the source of truth for every rendition:

- `pmdr-tomato.svg` is the full-color, higher-fidelity mark used in the README.
- `pmdr-tomato-*` is the monochrome outline weight — the idle and break mark.
- `pmdr-tomato-filled-*` is the solid weight — the focus mark. The ribs are
  punched out as real transparency so the silhouette does not collapse into a
  blob at menu-bar size.
- `pmdr-app-icon.svg` is the macOS app icon: the full-color mark on a warm
  rounded square, drawn on Apple's icon grid — an 824 px tile centred on a
  1024 px canvas, whose 100 px margin is where the drop shadow lives. The tile
  is a superellipse rather than a rounded rectangle, because that is the shape
  macOS icons actually are.

The small-size geometry sits in a 16×18 box: the mark itself occupies the top 16
units and the bottom two are empty padding. A status-item image is centred on the
button's vertical midline, while the timer digits have no descenders and so read
optically above it — the padding lifts the fruit back onto the digits' centre.

Generate the full-color SVG, both small-size weights, the app icon, and the Xcode
image sets with:

```sh
pnpm brand:assets
```

It emits 16, 18, and 32 px SVG/PNG previews here, installs vector-preserving
template SVGs in `apps/menubar/Resources/Assets.xcassets/PmdrTomato.imageset` and
`PmdrTomatoFilled.imageset`, and renders the ten `AppIcon.appiconset` PNGs.
Rasterizing goes through `@resvg/resvg-js` — a library, so there is nothing to
install, and unlike ImageMagick's bundled SVG renderer it draws `stroke`, which
is most of this mark.

The app icon is compiled into the bundle by `actool`, so nothing references it by
name: setting `ASSETCATALOG_COMPILER_APPICON_NAME` in `project.yml` and
`CFBundleIconName` in `Info.plist` is what makes it the app's icon. Because a
missing icon is a silent, still-succeeding build, `verify-menubar-zip.sh` fails a
release whose app has no compiled `AppIcon.icns`.

In AppKit, use `BrandIcon.templateImage(_:size:)` so the mark automatically
follows light/dark menu-bar appearance. Pick the weight with
`MenuBarIconStyle(status:)` rather than by hand — it also decides when the mark
is dimmed for a paused timer and supplies the VoiceOver label. The size default
is optically tuned for the menu bar; pass a square `NSSize` for smaller
context-menu use.
