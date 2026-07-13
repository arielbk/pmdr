#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = resolve(root, "design/brand");
const imageSetDir = resolve(
  root,
  "apps/menubar/Resources/Assets.xcassets/PmdrTomato.imageset",
);

function svgAtSize(size) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">`,
    `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">`,
    `  <path stroke-width="1.3" d="M2.1 7.1C2.6 5.5 4.6 4.9 6.5 5.3C7.5 5.5 8.5 5.5 9.5 5.3C11.4 4.9 13.4 5.5 13.9 7.1C14.7 9.6 13 12.8 10.8 13.7C9.8 14.1 8.8 13.6 8 13.1C7.2 13.6 6.2 14.1 5.2 13.7C3 12.8 1.3 9.6 2.1 7.1Z"/>`,
    `  <path stroke-width="1" d="M5.4 8.1C5.3 9.2 5.6 10.2 6.1 10.8M10.6 8.1C10.7 9.2 10.4 10.2 9.9 10.8"/>`,
    `</g>`,
    `<path fill="#000" d="M8 5.8L7.2 4.3L4.9 4.5L6.5 3.2L5.9 1.8L7.6 2.8L8 1.1L8.5 2.8L10.2 1.8L9.6 3.3L11.2 4.5L8.9 4.3Z"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

function fullColorSvg() {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" role="img" aria-labelledby="title description">`,
    `  <title id="title">pmdr tomato</title>`,
    `  <description id="description">A wide red tomato with a green star-shaped calyx</description>`,
    `  <path d="M42 142C53 109 92 96 131 105C150 110 170 110 189 105C228 96 267 109 278 142C294 192 260 256 216 274C196 282 176 272 160 262C144 272 124 282 104 274C60 256 26 192 42 142Z" fill="#ed4d43" stroke="#8d252b" stroke-width="8" stroke-linejoin="round"/>`,
    `  <path d="M68 151C80 126 104 117 134 124" fill="none" stroke="#ff9384" stroke-width="12" stroke-linecap="round"/>`,
    `  <circle cx="67" cy="151" r="5" fill="#ffb2a0"/>`,
    `  <path d="M254 149C261 184 246 222 216 247" fill="none" stroke="#c7363c" stroke-width="11" stroke-linecap="round"/>`,
    `  <path d="M111 158C109 181 115 202 126 216M209 158C211 181 205 202 194 216" fill="none" stroke="#b42e36" stroke-width="7" stroke-linecap="round"/>`,
    `  <path d="M113 151C111 166 114 179 119 190M207 151C209 166 206 179 201 190" fill="none" stroke="#ff796d" stroke-width="3" stroke-linecap="round"/>`,
    `  <path d="M160 116L143 87L97 91L129 65L117 36L151 57L160 22L170 57L204 36L192 66L224 91L178 87Z" fill="#3f7f4c" stroke="#245632" stroke-width="7" stroke-linejoin="round"/>`,
    `  <path d="M160 102L159 48M139 83L123 61M181 83L198 60" fill="none" stroke="#8fbf78" stroke-width="4" stroke-linecap="round"/>`,
    `</svg>`,
    ``,
  ].join("\n");
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function renderPng(svgPath, pngPath) {
  execFileSync("magick", ["-background", "none", svgPath, `PNG32:${pngPath}`]);
}

mkdirSync(brandDir, { recursive: true });
mkdirSync(imageSetDir, { recursive: true });

write(resolve(brandDir, "pmdr-tomato.svg"), fullColorSvg());

for (const size of [16, 18, 32]) {
  const svgPath = resolve(brandDir, `pmdr-tomato-${size}.svg`);
  const pngPath = resolve(brandDir, `pmdr-tomato-${size}.png`);
  write(svgPath, svgAtSize(size));
  renderPng(svgPath, pngPath);
}

for (const legacyName of ["pmdr-tomato.png", "pmdr-tomato@2x.png"]) {
  const legacyPath = resolve(imageSetDir, legacyName);
  if (existsSync(legacyPath)) unlinkSync(legacyPath);
}

write(resolve(imageSetDir, "pmdr-tomato.svg"), svgAtSize(16));

write(
  resolve(root, "apps/menubar/Resources/Assets.xcassets/Contents.json"),
  `${JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2)}\n`,
);

write(
  resolve(imageSetDir, "Contents.json"),
  `${JSON.stringify(
    {
      images: [{ filename: "pmdr-tomato.svg", idiom: "universal" }],
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

console.log(
  "Generated the full-color brand mark and 16, 18, and 32 px assets.",
);
