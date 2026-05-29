import { defineCommand } from "citty";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStateModule } from "../state.js";
import { getStatus } from "./status.js";

const DEFAULT_PORT = 7777;
const DEFAULT_HOST = "0.0.0.0";
const STATE_DIR = join(homedir(), ".local", "state", "pmdr");

type Store = ReturnType<typeof createStateModule>;

export interface StartedStatusServer {
  url: string;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

const STATUS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pmdr status</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f2ea;
      --fg: #141414;
      --muted: #5d5a55;
      --accent: #1f6f5b;
      --paused: #9f4f1f;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111313;
        --fg: #f6f1e8;
        --muted: #b8b0a5;
        --accent: #69c7aa;
        --paused: #f2a65f;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--fg);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(100vw, 960px);
      padding: 48px 24px;
      text-align: center;
    }

    .status-label {
      color: var(--accent);
      font-size: clamp(1.25rem, 4vw, 2.5rem);
      font-weight: 700;
      line-height: 1.1;
    }

    .countdown {
      margin-top: 18px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: clamp(5rem, 24vw, 15rem);
      font-weight: 800;
      line-height: 0.95;
      font-variant-numeric: tabular-nums;
    }

    .project {
      margin-top: 24px;
      color: var(--muted);
      font-size: clamp(1.25rem, 5vw, 3rem);
      font-weight: 650;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }

    body[data-state="idle"] .countdown,
    body[data-state="idle"] .project {
      display: none;
    }

    body[data-state="paused"] .status-label {
      color: var(--paused);
    }
  </style>
</head>
<body data-state="loading">
  <main aria-live="polite">
    <div class="status-label" data-testid="status-label">Loading</div>
    <div class="countdown" data-testid="countdown">--:--</div>
    <div class="project" data-testid="project"></div>
  </main>
  <script>
    const label = document.querySelector('[data-testid="status-label"]');
    const countdown = document.querySelector('[data-testid="countdown"]');
    const project = document.querySelector('[data-testid="project"]');

    function formatRemaining(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      return minutes + ":" + seconds;
    }

    function phaseLabel(status) {
      const phase = status.phase === "break" ? "Break" : "Focus";
      return status.state === "paused" ? phase + " paused" : phase;
    }

    function render(status) {
      document.body.dataset.state = status.state;

      if (status.state === "idle") {
        label.textContent = "Available";
        countdown.textContent = "--:--";
        project.textContent = "";
        return;
      }

      label.textContent = phaseLabel(status);
      countdown.textContent = formatRemaining(status.remainingMs);
      project.textContent = status.project || "";
    }

    fetch("/api/status", { cache: "no-store" })
      .then((response) => response.json())
      .then(render)
      .catch(() => {
        document.body.dataset.state = "error";
        label.textContent = "Unavailable";
        countdown.textContent = "--:--";
        project.textContent = "";
      });
  </script>
</body>
</html>`;

export function createStatusRequestHandler(options: {
  store: Store;
  now: () => number;
}) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res, STATUS_PAGE_HTML);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, getStatus({ store: options.store, now: options.now() }));
      return;
    }

    sendNotFound(res);
  };
}

export async function startStatusServer(options: {
  store: Store;
  port: number;
  host?: string;
  now?: () => number;
}): Promise<StartedStatusServer> {
  const host = options.host ?? DEFAULT_HOST;
  const server = createServer(
    createStatusRequestHandler({
      store: options.store,
      now: options.now ?? Date.now,
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : options.port;
  const displayHost = host === "0.0.0.0" ? "localhost" : host;

  return {
    url: `http://${displayHost}:${port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function parsePort(raw: unknown): number {
  const port = raw === undefined ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Port must be an integer between 1 and 65535.");
  }
  return port;
}

export default defineCommand({
  meta: {
    description: "Serve the current timer status on the local network",
  },
  args: {
    port: {
      type: "string",
      description: "Port to listen on",
      default: String(DEFAULT_PORT),
    },
  },
  async run({ args }) {
    const port = parsePort(args.port);
    const store = createStateModule(STATE_DIR);
    const server = await startStatusServer({ store, port, host: DEFAULT_HOST });

    console.log(`pmdr status server listening at ${server.url}`);

    await new Promise<void>((resolve) => {
      const stop = async () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        await server.close();
        resolve();
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
  },
});
