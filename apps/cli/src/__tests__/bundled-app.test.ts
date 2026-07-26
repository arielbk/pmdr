import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledAppDir, createBundledAppModule } from "../bundled-app.js";

describe("bundled app locator", () => {
  let bundleDir: string;

  beforeEach(() => {
    bundleDir = mkdtempSync(join(tmpdir(), "pmdr-bundled-app-"));
  });

  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it("reports absent when the install carries no app zip", () => {
    const bundled = createBundledAppModule(bundleDir);

    expect(bundled.locate()).toEqual({
      present: false,
      reason: "no bundled app zip in this install",
    });
  });

  it("resolves the zip path and its app version when packaged", () => {
    writeFileSync(join(bundleDir, "pmdr-app.zip"), "not-really-a-zip");
    writeFileSync(
      join(bundleDir, "pmdr-app.json"),
      `${JSON.stringify({ version: "0.4.1" })}\n`,
    );

    expect(createBundledAppModule(bundleDir).locate()).toEqual({
      present: true,
      zipPath: join(bundleDir, "pmdr-app.zip"),
      version: "0.4.1",
    });
  });

  it("reports absent rather than throwing when the zip has no readable metadata", () => {
    writeFileSync(join(bundleDir, "pmdr-app.zip"), "not-really-a-zip");

    expect(createBundledAppModule(bundleDir).locate()).toEqual({
      present: false,
      reason: "bundled app zip has no readable version metadata",
    });

    writeFileSync(join(bundleDir, "pmdr-app.json"), "{ this is not json");

    expect(createBundledAppModule(bundleDir).locate()).toEqual({
      present: false,
      reason: "bundled app zip has no readable version metadata",
    });
  });

  it("defaults to a directory alongside the installed package's manifest", () => {
    const dir = bundledAppDir();

    expect(dir.endsWith("/bundled-app")).toBe(true);
    expect(existsSync(join(dirname(dir), "package.json"))).toBe(true);
  });
});
