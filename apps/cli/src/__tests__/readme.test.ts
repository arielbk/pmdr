import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("README CLI documentation", () => {
  const readme = readFileSync(join(__dirname, "../../../../README.md"), "utf8");

  it("documents how the release gets the CI-built app and refuses to ship without it", () => {
    // Deliberately not `\z` — that is a literal "z" in JS regex, which would
    // truncate this section at the first "pmdr-app.zip".
    const section = readme.match(/### Releasing\n([\s\S]*?)\n## /)?.[1];

    expect(section).toContain("gh run download --name pmdr-app");
    expect(section).toContain("--app-artifact");
    expect(section).toContain("--allow-missing-app");
    expect(section).toContain(".github/workflows/menubar-app.yml");
  });

  it("documents that the release refuses a zip older than the menubar sources", () => {
    const section = readme.match(/### Releasing\n([\s\S]*?)\n## /)?.[1];

    expect(section).toContain("MARKETING_VERSION");
    expect(section).toContain("apps/menubar/project.yml");
  });

  it("documents serving the LAN status page", () => {
    const runningCliSection = readme.match(
      /## Running the CLI([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(runningCliSection).toContain("pmdr serve");
    expect(runningCliSection).toContain("--port");
    expect(runningCliSection).toContain("http://<machine-name>.local:<port>");
  });

  it("documents that only `pmdr setup` needs a TTY, and what it does without one", () => {
    const runningCliSection = readme.match(
      /## Running the CLI([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(runningCliSection).toContain("interactive terminal");
    expect(runningCliSection).toContain("pmdr status --json");
    expect(runningCliSection).toContain("pmdr app install");
  });

  it("documents what bare `pmdr` routes to", () => {
    const runningCliSection = readme.match(
      /## Running the CLI([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(runningCliSection).toContain("pmdr setup");
    expect(runningCliSection).toContain("Attaches to it");
    // The rule that keeps an upgrade from re-onboarding an existing install.
    expect(runningCliSection).toContain("never drops an existing install back");
  });

  // Note the terminator: `\z` is a literal "z" in JS regex, so the older
  // sections above stop at the first word containing one. `\n## ` is the real
  // "next top-level heading" boundary.
  const integrations = readme.match(/\n## Integrations\n([\s\S]*?)\n## /)?.[1];

  it("documents the status payload fields an integration renders from", () => {
    const section = integrations;

    expect(section).toContain("pmdr status --json");
    expect(section).toContain("endsAt");
    expect(section).toContain("remainingMs");
    // The idle payload has no `endsAt` key at all — a consumer that assumes
    // the field is always present breaks the moment the timer stops.
    expect(section).toContain('{ "state": "idle" }');
  });

  it("documents the render rule that keeps a countdown drift-free", () => {
    expect(integrations).toContain("endsAt - now");
    expect(integrations).toContain("paused");
    expect(integrations).toContain("frozen");
    // The point of the rule: the consumer ticks on its own clock instead of
    // decrementing the value it was handed at poll time.
    expect(integrations).toMatch(/do not|never/i);
  });

  it("documents when to re-poll, including watching the state file", () => {
    expect(integrations).toContain("state.json");
    expect(integrations).toContain("fswatch");
    // A read is what advances an expired phase, so polling is not just for the
    // consumer's benefit.
    expect(integrations).toMatch(/advance/i);
  });

  it("records that a daemon, sockets, and exec hooks are rejected", () => {
    expect(integrations).toMatch(/no daemon/i);
    expect(integrations).toContain("socket");
    expect(integrations).toContain("hooks");
    expect(integrations).toContain("pull contract");
  });

  it("documents installing the bundled menubar app from the CLI", () => {
    const section = readme.match(
      /## The bundled menubar app([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(section).toContain("pmdr app install");
    expect(section).toContain("pmdr app status --json");
    expect(section).toContain("pmdr app uninstall");
    expect(section).toContain("~/Applications");
  });

  it("documents launching the menubar app at login", () => {
    const section = readme.match(
      /## The bundled menubar app([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(section).toContain("pmdr app login --enable");
    expect(section).toContain("pmdr app login --disable");
    expect(section).toContain("~/Library/LaunchAgents");
  });

  it("documents the first-run install offer and how it is gated", () => {
    const section = readme.match(
      /## The bundled menubar app([\s\S]*?)(?:\n## |\z)/,
    )?.[1];

    expect(section).toContain("interactive terminal");
    expect(section).toContain("never asks again");
    expect(section).toContain("--json");
    expect(section).toContain("TTY");
  });
});
