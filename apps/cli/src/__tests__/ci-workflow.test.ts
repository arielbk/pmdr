import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ARTIFACT_NAME } from "../release.js";

const repoRoot = join(__dirname, "../../../..");
const workflowPath = join(repoRoot, ".github/workflows/menubar-app.yml");

describe("menubar app CI workflow", () => {
  const workflow = existsSync(workflowPath)
    ? readFileSync(workflowPath, "utf8")
    : "";

  it("exists and runs on a macOS runner", () => {
    expect(workflow).toMatch(/runs-on:\s*macos-/);
  });

  it("uploads the app zip under the artifact name the release downloads", () => {
    expect(workflow).toContain(`name: ${APP_ARTIFACT_NAME}`);
    expect(workflow).toContain("apps/cli/bundled-app/pmdr-app.zip");
    expect(workflow).toContain("apps/cli/bundled-app/pmdr-app.json");
  });

  it("builds and verifies the zip with the checked-in scripts", () => {
    for (const script of [
      "scripts/build-menubar-zip.sh",
      "scripts/verify-menubar-zip.sh",
    ]) {
      expect(workflow).toContain(script);
      expect(existsSync(join(repoRoot, script))).toBe(true);
    }
  });
});
