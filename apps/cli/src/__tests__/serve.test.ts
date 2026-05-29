import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import { createStatusRequestHandler } from "../commands/serve.js";

describe("pmdr serve /api/status", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-serve-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function getStatusJson() {
    const handler = createStatusRequestHandler({
      store,
      now: () => NOW,
    });
    const response = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: "",
      writeHead(statusCode: number, headers: Record<string, string>) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(body: string) {
        this.body = body;
      },
    };

    handler({ method: "GET", url: "/api/status" } as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    return JSON.parse(response.body);
  }

  it("returns idle status JSON from a temp-dir state module", () => {
    expect(getStatusJson()).toEqual({ state: "idle" });
  });

  it("returns running status JSON from a temp-dir state module", () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "deepwork",
      phase: "focus",
      completedFocusBlocks: 0,
    });

    expect(getStatusJson()).toEqual({
      state: "running",
      remainingMs: 55_000,
      duration: 60_000,
      startedAt: NOW - 5_000,
      phase: "focus",
      completedFocusBlocks: 0,
      todayFocusBlocks: 0,
      project: "deepwork",
    });
  });

  it("returns paused status JSON from a temp-dir state module", () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
      project: "deepwork",
      phase: "focus",
      completedFocusBlocks: 1,
    });

    expect(getStatusJson()).toMatchObject({
      state: "paused",
      remainingMs: 52_000,
      project: "deepwork",
    });
  });
});
