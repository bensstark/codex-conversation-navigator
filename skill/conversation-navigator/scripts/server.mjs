import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { AppServerClient } from "./app-server-client.mjs";
import { projectThread } from "./transcript.mjs";

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/markdown.js", ["markdown.js", "text/javascript; charset=utf-8"]],
  ["/vendor/marked.esm.js", ["vendor/marked.esm.js", "text/javascript; charset=utf-8"]],
  ["/vendor/purify.es.mjs", ["vendor/purify.es.mjs", "text/javascript; charset=utf-8"]],
  ["/vendor/highlight.min.js", ["vendor/highlight.min.js", "text/javascript; charset=utf-8"]],
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: http: https:",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SOURCE_FILTERS = new Map([
  ["all", ["vscode", "cli"]],
  ["vscode", ["vscode"]],
  ["cli", ["cli"]],
]);

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function openInBrowser(url) {
  let command;
  let args;

  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/c", "start", "", url];
  } else if (process.env.WSL_DISTRO_NAME) {
    command = "cmd.exe";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The printed URL remains the reliable fallback.
  }
}

export function parseCliArgs(args) {
  const options = {
    cwd: process.cwd(),
    openUrl: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-open") {
      options.openUrl = false;
    } else if (argument === "--cwd") {
      const cwd = args[index + 1];
      if (!cwd || cwd.startsWith("--")) {
        throw new Error("--cwd requires a path");
      }
      options.cwd = resolve(cwd);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

export async function createNavigatorServer({
  client,
  cwd,
  webRoot = fileURLToPath(new URL("../assets/web/", import.meta.url)),
  idleMs = 30 * 60_000,
  openUrl = true,
}) {
  let closed = false;
  let lastActivity = Date.now();
  let idleTimer = null;

  const server = createServer(async (request, response) => {
    lastActivity = Date.now();
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        if (requestUrl.pathname === "/api/threads") {
          const source = requestUrl.searchParams.get("source") ?? "all";
          const sourceKinds = SOURCE_FILTERS.get(source);
          if (!sourceKinds) {
            sendJson(response, 400, { error: "Invalid source filter" });
            return;
          }
          const threads = await client.listThreads(cwd, sourceKinds);
          sendJson(response, 200, {
            cwd,
            threads: threads.map((thread) => ({
              id: thread.id,
              name: thread.name ?? null,
              preview: thread.preview ?? "",
              updatedAt: thread.updatedAt ?? null,
              source: thread.source,
            })),
          });
          return;
        }

        const match = requestUrl.pathname.match(/^\/api\/threads\/(.+)$/);
        if (match) {
          const thread = await client.readThread(decodeURIComponent(match[1]));
          sendJson(response, 200, { thread: projectThread(thread) });
          return;
        }

        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const staticFile = STATIC_FILES.get(requestUrl.pathname);
      if (!staticFile) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const [fileName, contentType] = staticFile;
      const contents = await readFile(resolve(webRoot, fileName));
      response.writeHead(200, {
        "content-type": contentType,
        "content-security-policy": CONTENT_SECURITY_POLICY,
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(contents);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  async function close() {
    if (closed) {
      return;
    }
    closed = true;
    if (idleTimer) {
      clearInterval(idleTimer);
    }
    await new Promise((resolveClose) => {
      if (!server.listening) {
        resolveClose();
        return;
      }
      server.close(resolveClose);
    });
    client.stop();
  }

  if (idleMs > 0) {
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivity >= idleMs) {
        void close();
      }
    }, Math.min(idleMs, 1_000));
    idleTimer.unref();
  }

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  if (openUrl) {
    openInBrowser(url);
  }

  return { url, close };
}

async function runCli() {
  const options = parseCliArgs(process.argv.slice(2));
  const client = new AppServerClient();
  let navigator;

  try {
    await client.start();
    navigator = await createNavigatorServer({ client, ...options });
    console.log(`Conversation Navigator: ${navigator.url}`);
  } catch (error) {
    client.stop();
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const stop = async () => {
    await navigator.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const isCli = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  await runCli();
}
