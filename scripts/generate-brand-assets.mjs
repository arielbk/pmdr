#!/usr/bin/env node

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = resolve(root, "design/brand");
const imageSetDir = (name) =>
  resolve(root, `apps/menubar/Resources/Assets.xcassets/${name}.imageset`);

// The mark lives in a 16-unit-wide box but the viewBox is 18 units tall: the
// two extra units are empty padding below the fruit. A status-item image is
// centred on the button's vertical midline, while the timer's digits have no
// descenders and so sit optically above that midline. The bottom padding pushes
// the ink up by one unit when the box is centred, lining the tomato up with the
// digits instead of hanging below their baseline.
const unitsWide = 16;
const unitsTall = 18;

const body =
  "M2.1 7.1C2.6 5.5 4.6 4.9 6.5 5.3C7.5 5.5 8.5 5.5 9.5 5.3C11.4 4.9 13.4 5.5 13.9 7.1C14.7 9.6 13 12.8 10.8 13.7C9.8 14.1 8.8 13.6 8 13.1C7.2 13.6 6.2 14.1 5.2 13.7C3 12.8 1.3 9.6 2.1 7.1Z";
const calyx =
  "M8 5.8L7.2 4.3L4.9 4.5L6.5 3.2L5.9 1.8L7.6 2.8L8 1.1L8.5 2.8L10.2 1.8L9.6 3.3L11.2 4.5L8.9 4.3Z";
// The ribs as stroked centre lines (outline weight) and as closed shapes that
// can be punched out of a solid body (filled weight). The closed pair is a
// hand-fitted 1-unit-wide offset of the same curves — at this size the exact
// curvature is invisible, only the sliver of negative space registers.
const ribStrokes =
  "M5.4 8.1C5.3 9.2 5.6 10.2 6.1 10.8M10.6 8.1C10.7 9.2 10.4 10.2 9.9 10.8";
const ribHoles = [
  "M4.9 7.9C4.8 9.2 5.1 10.3 5.6 11.0L6.6 11.0C6.1 10.3 5.8 9.2 5.9 7.9Z",
  "M11.1 7.9C11.2 9.2 10.9 10.3 10.4 11.0L9.4 11.0C9.9 10.3 10.2 9.2 10.1 7.9Z",
].join("");

function svgDocument(width, marks) {
  const height = (width * unitsTall) / unitsWide;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${unitsWide} ${unitsTall}">`,
    ...marks,
    `</svg>`,
    "",
  ].join("\n");
}

/// Outline weight — the break and idle mark.
function svgAtSize(width) {
  return svgDocument(width, [
    `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">`,
    `  <path stroke-width="1.3" d="${body}"/>`,
    `  <path stroke-width="1" d="${ribStrokes}"/>`,
    `</g>`,
    `<path fill="#000" d="${calyx}"/>`,
  ]);
}

/// Filled weight — the focus mark.
///
/// A plain solid fill collapses into an unreadable blob at menu-bar size, so the
/// ribs are punched back out as negative space via `fill-rule="evenodd"`. The
/// holes must be genuine transparency: a template image is rendered from its
/// alpha channel alone, so drawing the ribs in white would just tint them the
/// same colour as the body. The body is filled and stroked as two separate paths
/// so that the stroke traces only the outer silhouette — stroking the combined
/// path would paint the 1.3-wide band back over the rib holes and seal them.
function filledSvgAtSize(width) {
  return svgDocument(width, [
    `<path fill="#000" fill-rule="evenodd" d="${body}${ribHoles}"/>`,
    `<path fill="none" stroke="#000" stroke-width="1.3" stroke-linejoin="round" d="${body}"/>`,
    `<path fill="#000" d="${calyx}"/>`,
  ]);
}

/// The full-color mark, drawn in its own 320-unit box. Shared by the README
/// rendition and the app icon, so the two can never drift apart.
const fullColorMarks = [
  `<path d="M42 142C53 109 92 96 131 105C150 110 170 110 189 105C228 96 267 109 278 142C294 192 260 256 216 274C196 282 176 272 160 262C144 272 124 282 104 274C60 256 26 192 42 142Z" fill="#ed4d43" stroke="#8d252b" stroke-width="8" stroke-linejoin="round"/>`,
  `<path d="M68 151C80 126 104 117 134 124" fill="none" stroke="#ff9384" stroke-width="12" stroke-linecap="round"/>`,
  `<circle cx="67" cy="151" r="5" fill="#ffb2a0"/>`,
  `<path d="M254 149C261 184 246 222 216 247" fill="none" stroke="#c7363c" stroke-width="11" stroke-linecap="round"/>`,
  `<path d="M111 158C109 181 115 202 126 216M209 158C211 181 205 202 194 216" fill="none" stroke="#b42e36" stroke-width="7" stroke-linecap="round"/>`,
  `<path d="M113 151C111 166 114 179 119 190M207 151C209 166 206 179 201 190" fill="none" stroke="#ff796d" stroke-width="3" stroke-linecap="round"/>`,
  `<path d="M160 116L143 87L97 91L129 65L117 36L151 57L160 22L170 57L204 36L192 66L224 91L178 87Z" fill="#3f7f4c" stroke="#245632" stroke-width="7" stroke-linejoin="round"/>`,
  `<path d="M160 102L159 48M139 83L123 61M181 83L198 60" fill="none" stroke="#8fbf78" stroke-width="4" stroke-linecap="round"/>`,
];

/// Where the mark's ink actually sits inside its 320-unit box. The box has slack
/// on every side, so centring the box would leave the icon visibly low and left.
const markInk = { x: 26, y: 22, width: 268, height: 260 };

function fullColorSvg() {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" role="img" aria-labelledby="title description">`,
    `  <title id="title">pmdr tomato</title>`,
    `  <description id="description">A wide red tomato with a green star-shaped calyx</description>`,
    ...fullColorMarks.map((mark) => `  ${mark}`),
    `</svg>`,
    ``,
  ].join("\n");
}

// The macOS icon grid: a 1024 px canvas whose rounded square is 824 px, leaving
// a 100 px margin all round for the drop shadow to live in without the tile
// touching its neighbours in Finder.
const iconCanvas = 1024;
const iconTile = 824;
/// How much of the tile's width the mark's ink spans. Larger reads better in the
/// menu-bar-adjacent sizes; much larger and the tomato starts to feel crammed.
const iconMarkScale = 0.7;

/**
 * Apple's rounded square is a superellipse, not a rounded rectangle: its
 * curvature runs continuously into the straight edges rather than meeting them
 * at a tangent. Sampling |x|^n + |y|^n = half^n as a dense polygon gets that
 * shape exactly, and at 1024 px the segments are far below a pixel.
 */
function squirclePath(centre, half, exponent = 6, steps = 720) {
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = Math.sign(cos) * Math.abs(cos) ** (2 / exponent) * half;
    const y = Math.sign(sin) * Math.abs(sin) ** (2 / exponent) * half;
    points.push(`${(centre + x).toFixed(2)} ${(centre + y).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

/**
 * The app icon: the full-color mark on the warm tile, on the macOS icon grid.
 *
 * The app is `LSUIElement`, so this is never a Dock icon — it is what Finder,
 * System Settings' Login Items and notification banners show. Those surfaces all
 * draw it small, which is why the mark is the whole composition: no wordmark, no
 * clock face, nothing that would turn to mush at 32 px.
 */
function appIconSvg() {
  const scale =
    (iconTile * iconMarkScale) / Math.max(markInk.width, markInk.height);
  const x = iconCanvas / 2 - (markInk.x + markInk.width / 2) * scale;
  const y = iconCanvas / 2 - (markInk.y + markInk.height / 2) * scale;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${iconCanvas}" height="${iconCanvas}" viewBox="0 0 ${iconCanvas} ${iconCanvas}" role="img" aria-labelledby="title description">`,
    `  <title id="title">pmdr</title>`,
    `  <description id="description">The pmdr tomato on a warm rounded square</description>`,
    `  <defs>`,
    `    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">`,
    `      <stop offset="0" stop-color="#fffaf3"/>`,
    `      <stop offset="1" stop-color="#f6e3cd"/>`,
    `    </linearGradient>`,
    `    <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%">`,
    `      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.28"/>`,
    `    </filter>`,
    `  </defs>`,
    `  <path d="${squirclePath(iconCanvas / 2, iconTile / 2)}" fill="url(#tile)" filter="url(#tileShadow)"/>`,
    `  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">`,
    ...fullColorMarks.map((mark) => `    ${mark}`),
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/// The renditions macOS asks for, as `[point size, scale]` pairs.
const appIconRenditions = [
  [16, 1],
  [16, 2],
  [32, 1],
  [32, 2],
  [128, 1],
  [128, 2],
  [256, 1],
  [256, 2],
  [512, 1],
  [512, 2],
];

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * resvg rather than ImageMagick: IM's bundled SVG renderer silently drops
 * `stroke` on every path, and the mark is mostly strokes — it rendered the
 * calyx and nothing else. resvg is a library, so there is no system dependency
 * to install either.
 */
function renderPng(svg, pngPath, width) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } })
    .render()
    .asPng();
  write(pngPath, png);
}

const weights = [
  { slug: "pmdr-tomato", imageSet: "PmdrTomato", svg: svgAtSize },
  {
    slug: "pmdr-tomato-filled",
    imageSet: "PmdrTomatoFilled",
    svg: filledSvgAtSize,
  },
];

mkdirSync(brandDir, { recursive: true });

write(resolve(brandDir, "pmdr-tomato.svg"), fullColorSvg());

for (const legacyName of ["pmdr-tomato.png", "pmdr-tomato@2x.png"]) {
  const legacyPath = resolve(imageSetDir("PmdrTomato"), legacyName);
  if (existsSync(legacyPath)) unlinkSync(legacyPath);
}

for (const weight of weights) {
  for (const size of [16, 18, 32]) {
    const svg = weight.svg(size);
    write(resolve(brandDir, `${weight.slug}-${size}.svg`), svg);
    renderPng(svg, resolve(brandDir, `${weight.slug}-${size}.png`), size);
  }

  const dir = imageSetDir(weight.imageSet);
  mkdirSync(dir, { recursive: true });
  write(resolve(dir, `${weight.slug}.svg`), weight.svg(16));
  write(
    resolve(dir, "Contents.json"),
    `${JSON.stringify(
      {
        images: [{ filename: `${weight.slug}.svg`, idiom: "universal" }],
        info: { author: "xcode", version: 1 },
        properties: {
          "preserves-vector-representation": true,
          "template-rendering-intent": "template",
        },
      },
      null,
      2,
    )}\n`,
  );
}

const appIcon = appIconSvg();
write(resolve(brandDir, "pmdr-app-icon.svg"), appIcon);

const appIconDir = resolve(
  root,
  "apps/menubar/Resources/Assets.xcassets/AppIcon.appiconset",
);
for (const [size, scale] of appIconRenditions) {
  const pixels = size * scale;
  renderPng(appIcon, resolve(appIconDir, `pmdr-${pixels}.png`), pixels);
}
write(
  resolve(appIconDir, "Contents.json"),
  `${JSON.stringify(
    {
      images: appIconRenditions.map(([size, scale]) => ({
        filename: `pmdr-${size * scale}.png`,
        idiom: "mac",
        scale: `${scale}x`,
        size: `${size}x${size}`,
      })),
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  )}\n`,
);

write(
  resolve(root, "apps/menubar/Resources/Assets.xcassets/Contents.json"),
  `${JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2)}\n`,
);

console.log(
  "Generated the full-color brand mark, the outline and filled 16, 18, and 32 px assets, and the app icon.",
);
