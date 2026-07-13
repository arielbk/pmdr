# pmdr tomato

The pmdr mark is a wide, squat tomato with visible bottom lobes, an oversized
star-like calyx, and two short rib lines. Those details keep the silhouette
recognizable across the terminal, README, and native macOS surfaces without
letting it read as an apple or pumpkin.

`scripts/generate-brand-assets.mjs` is the source of truth for both renditions:

- `pmdr-tomato.svg` is the full-color, higher-fidelity mark used in the README.
- The 16×16 geometry is the monochrome small-size mark used by the menu bar and
  future native context-menu items.

Generate the full-color SVG, small-size SVG/PNG previews, and Xcode image set
with:

```sh
pnpm brand:assets
```

The generator requires ImageMagick's `magick` executable for PNG previews. It
emits 16, 18, and 32 px SVG/PNG previews here and installs a vector-preserving
template SVG in `apps/menubar/Resources/Assets.xcassets/PmdrTomato.imageset`.

In AppKit, use `BrandIcon.templateImage(size:)` so the mark automatically follows
light/dark menu-bar appearance. Its menu-bar default is optically sized to 19×20
pt; pass a square `NSSize` for smaller context-menu use.
