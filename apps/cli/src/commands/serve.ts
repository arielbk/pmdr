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

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

export function createStatusRequestHandler(options: {
  store: Store;
  now: () => number;
}) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");

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
