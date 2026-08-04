import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  basename,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { AppServerClient } from "./app-server-client.mjs";
import { projectThread } from "./transcript.mjs";

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/markdown.js", ["markdown.js", "text/javascript; charset=utf-8"]],
  ["/theme.js", ["theme.js", "text/javascript; charset=utf-8"]],
  ["/file-viewer.html", ["file-viewer.html", "text/html; charset=utf-8"]],
  ["/file-viewer.js", ["file-viewer.js", "text/javascript; charset=utf-8"]],
  ["/file-viewer.css", ["file-viewer.css", "text/css; charset=utf-8"]],
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

const MAX_LOCAL_FILE_BYTES = 4 * 1024 * 1024;

class LocalFileRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isWithinDirectory(root, target) {
  const relativePath = relative(root, target);
  return relativePath === ""
    || (!relativePath.startsWith(`..${sep}`)
      && relativePath !== ".."
      && !isAbsolute(relativePath));
}

function localFileCandidates(requestedPath) {
  const candidates = [{ path: requestedPath, line: null }];
  // Codex file links may append a line or line/column suffix to an absolute path.
  const lineMatch = requestedPath.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (lineMatch && lineMatch[1]) {
    candidates.push({ path: lineMatch[1], line: Number(lineMatch[2]) });
  }
  return candidates;
}

async function resolveLocalFile(cwd, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new LocalFileRequestError(400, "A local file path is required");
  }

  let root;
  try {
    root = await realpath(cwd);
  } catch {
    throw new LocalFileRequestError(404, "Local file not found");
  }

  for (const candidate of localFileCandidates(requestedPath.trim())) {
    const absolutePath = isAbsolute(candidate.path)
      ? resolve(candidate.path)
      : resolve(root, candidate.path);
    let target;
    try {
      target = await realpath(absolutePath);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EINVAL"].includes(error.code)) {
        continue;
      }
      throw new LocalFileRequestError(403, "Local file cannot be read");
    }

    if (!isWithinDirectory(root, target)) {
      throw new LocalFileRequestError(403, "Local file is outside the launch directory");
    }

    let details;
    try {
      details = await stat(target);
    } catch {
      throw new LocalFileRequestError(404, "Local file not found");
    }
    if (!details.isFile()) {
      throw new LocalFileRequestError(404, "Local file not found");
    }
    if (details.size > MAX_LOCAL_FILE_BYTES) {
      throw new LocalFileRequestError(413, "Local file is too large to preview");
    }

    return {
      path: target,
      line: candidate.line,
    };
  }

  throw new LocalFileRequestError(404, "Local file not found");
}

function localFileHeaders(filePath, size) {
  const fileName = basename(filePath).replace(/["\\\r\n]/g, "_") || "file";
  return {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": `inline; filename="${fileName}"`,
    "content-length": String(size),
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

async function sendLocalFile(response, file) {
  let contents;
  try {
    contents = await readFile(file.path);
  } catch {
    throw new LocalFileRequestError(403, "Local file cannot be read");
  }
  response.writeHead(200, localFileHeaders(file.path, contents.byteLength));
  response.end(contents);
}

function localFileViewerLocation(requestUrl, requestedPath) {
  const viewerUrl = new URL("/file-viewer.html", requestUrl);
  viewerUrl.searchParams.set("path", requestedPath);
  return `${viewerUrl.pathname}${viewerUrl.search}`;
}

function redirectToLocalFileViewer(response, requestUrl, requestedPath) {
  response.writeHead(302, {
    location: localFileViewerLocation(requestUrl, requestedPath),
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end();
}

function sendLocalFileError(response, error) {
  if (!(error instanceof LocalFileRequestError)) {
    return false;
  }
  sendJson(response, error.status, { error: error.message });
  return true;
}

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
        if (requestUrl.pathname === "/api/local-file") {
          try {
            const file = await resolveLocalFile(cwd, requestUrl.searchParams.get("path"));
            await sendLocalFile(response, file);
          } catch (error) {
            if (!sendLocalFileError(response, error)) {
              throw error;
            }
          }
          return;
        }

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
        // Absolute Codex file links land here; serve only files below --cwd.
        let requestedPath;
        try {
          requestedPath = decodeURIComponent(requestUrl.pathname);
        } catch {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        const launchPath = resolve(cwd);
        if (requestedPath === launchPath
            || requestedPath.startsWith(`${launchPath}${sep}`)) {
          try {
            await resolveLocalFile(cwd, requestedPath);
            redirectToLocalFileViewer(response, requestUrl, requestedPath);
          } catch (error) {
            if (!sendLocalFileError(response, error)) {
              throw error;
            }
          }
          return;
        }

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
