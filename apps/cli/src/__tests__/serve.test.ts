import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
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
      longBreakEvery: 4,
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

describe("pmdr serve status page", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateModule>;
  const NOW = 1_000_000;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pmdr-page-test-"));
    store = createStateModule(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function getPageHtml() {
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

    handler({ method: "GET", url: "/" } as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    return response.body;
  }

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
    return JSON.parse(response.body);
  }

  async function renderPage(status: unknown) {
    const html = getPageHtml();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();

    const nodes = {
      label: { textContent: "" },
      countdown: { textContent: "" },
      project: { textContent: "" },
    };
    const document = {
      body: { dataset: {} as Record<string, string> },
      querySelector(selector: string) {
        if (selector === '[data-testid="status-label"]') return nodes.label;
        if (selector === '[data-testid="countdown"]') return nodes.countdown;
        if (selector === '[data-testid="project"]') return nodes.project;
        return null;
      },
    };

    runInNewContext(script!, {
      document,
      fetch: async () => ({
        json: async () => status,
      }),
      setInterval: () => 0,
      clearInterval: () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));

    return { document, nodes };
  }

  async function renderPageWithTimers(statusOrStatuses: unknown | unknown[]) {
    vi.useFakeTimers({ now: NOW });
    const html = getPageHtml();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const statuses = Array.isArray(statusOrStatuses)
      ? [...statusOrStatuses]
      : [statusOrStatuses];
    let fetchCount = 0;

    const nodes = {
      label: { textContent: "" },
      countdown: { textContent: "" },
      project: { textContent: "" },
    };
    const document = {
      body: { dataset: {} as Record<string, string> },
      querySelector(selector: string) {
        if (selector === '[data-testid="status-label"]') return nodes.label;
        if (selector === '[data-testid="countdown"]') return nodes.countdown;
        if (selector === '[data-testid="project"]') return nodes.project;
        return null;
      },
    };

    runInNewContext(script!, {
      document,
      fetch: async () => {
        const status =
          statuses[Math.min(fetchCount, statuses.length - 1)] ?? {
            state: "idle",
          };
        fetchCount += 1;
        return {
          json: async () => status,
        };
      },
      Date,
      setInterval,
      clearInterval,
    });
    await vi.advanceTimersByTimeAsync(0);

    return { document, nodes, fetchCount: () => fetchCount };
  }

  it("serves a self-contained page that can render running and idle status", () => {
    const html = getPageHtml();

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("fetch(\"/api/status\"");
    expect(html).toContain("Available");
    expect(html).toContain("data-testid=\"status-label\"");
    expect(html).toContain("data-testid=\"countdown\"");
    expect(html).toContain("data-testid=\"project\"");
  });

  it("renders a running session after the initial status fetch", async () => {
    store.writeState({
      startedAt: NOW - 5_000,
      durationMs: 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      project: "deepwork",
      phase: "focus",
      completedFocusBlocks: 0,
    });
    const status = getStatusJson();

    const { document, nodes } = await renderPage(status);

    expect(document.body.dataset.state).toBe("running");
    expect(nodes.label.textContent).toBe("Focus");
    expect(nodes.countdown.textContent).toBe("0:55");
    expect(nodes.project.textContent).toBe("deepwork");
  });

  it("renders idle status as Available after the initial status fetch", async () => {
    const status = getStatusJson();

    const { document, nodes } = await renderPage(status);

    expect(document.body.dataset.state).toBe("idle");
    expect(nodes.label.textContent).toBe("Available");
    expect(nodes.countdown.textContent).toBe("--:--");
    expect(nodes.project.textContent).toBe("");
  });

  it("renders paused status distinctly after the initial status fetch", async () => {
    store.writeState({
      startedAt: NOW - 10_000,
      durationMs: 60_000,
      pausedAt: NOW - 2_000,
      accumulatedPauseMs: 0,
      project: "deepwork",
      phase: "focus",
      completedFocusBlocks: 0,
    });
    const status = getStatusJson();

    const { document, nodes } = await renderPage(status);

    expect(document.body.dataset.state).toBe("paused");
    expect(nodes.label.textContent).toBe("Focus paused");
    expect(nodes.countdown.textContent).toBe("0:52");
    expect(nodes.project.textContent).toBe("deepwork");
  });

  it("ticks the running countdown locally between status polls", async () => {
    try {
      const { nodes } = await renderPageWithTimers({
        state: "running",
        remainingMs: 55_000,
        duration: 60_000,
        startedAt: NOW - 5_000,
        phase: "focus",
        completedFocusBlocks: 0,
        todayFocusBlocks: 0,
        project: "deepwork",
      });

      expect(nodes.countdown.textContent).toBe("0:55");

      await vi.advanceTimersByTimeAsync(1_100);

      expect(nodes.countdown.textContent).toBe("0:54");
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls status and updates the already loaded page", async () => {
    try {
      const { nodes, fetchCount } = await renderPageWithTimers([
        {
          state: "running",
          remainingMs: 55_000,
          duration: 60_000,
          startedAt: NOW - 5_000,
          phase: "focus",
          completedFocusBlocks: 0,
          todayFocusBlocks: 0,
          project: "deepwork",
        },
        {
          state: "paused",
          remainingMs: 52_000,
          duration: 60_000,
          startedAt: NOW - 10_000,
          phase: "focus",
          completedFocusBlocks: 0,
          todayFocusBlocks: 0,
          project: "deepwork",
        },
      ]);

      expect(fetchCount()).toBe(1);
      expect(nodes.label.textContent).toBe("Focus");

      await vi.advanceTimersByTimeAsync(5_000);

      expect(fetchCount()).toBe(2);
      expect(nodes.label.textContent).toBe("Focus paused");
      expect(nodes.countdown.textContent).toBe("0:52");
      expect(nodes.project.textContent).toBe("deepwork");
    } finally {
      vi.useRealTimers();
    }
  });
});
