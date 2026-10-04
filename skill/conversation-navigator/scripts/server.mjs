import { spawn } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  posix,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import { AppServerClient } from "./app-server-client.mjs";
import { isMainModule } from "./entrypoint.mjs";
import { projectThread } from "./transcript.mjs";
import { visualizationDirectives } from "../assets/web/visualizations.js";
import { VISUALIZATION_CSP, visualizationDocument, visualizationErrorDocument } from "./visualization-frame.mjs";

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/markdown.js", ["markdown.js", "text/javascript; charset=utf-8"]],
  ["/visualizations.js", ["visualizations.js", "text/javascript; charset=utf-8"]],
  ["/math-markdown.js", ["math-markdown.js", "text/javascript; charset=utf-8"]],
  ["/math.css", ["math.css", "text/css; charset=utf-8"]],
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
  // KaTeX creates layout style attributes after user HTML is sanitized.
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: http: https:",
  "media-src 'none'",
  "frame-src 'self'",
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
const MAX_VISUALIZATION_BYTES = 1024 * 1024;

// The extra visualization root is NOT added to the general local-file viewer.
// Only HTML explicitly referenced by the requested thread is eligible here.
export async function readVisualization({ cwd, visualizationRoot, thread, requestedPath }) {
  if (!thread || typeof thread.cwd !== "string" || resolve(thread.cwd) !== resolve(cwd)) {
    throw new LocalFileRequestError(403, "该对话不属于当前启动目录");
  }
  if (typeof requestedPath !== "string" || !isAbsolute(requestedPath)
      || !/\.html?$/i.test(requestedPath) || requestedPath.length > 4096
      || /[\r\n\0]/.test(requestedPath)) {
    throw new LocalFileRequestError(400, "无效的可视化 HTML 路径");
  }
  const absolutePath = resolve(requestedPath);
  const referenced = projectThread(thread).turns.some((turn) => turn.messages.some((message) =>
    visualizationDirectives(message.text).some((directive) => resolve(directive.path) === absolutePath)));
  if (!referenced) throw new LocalFileRequestError(403, "该图未被当前对话引用");

  let allowedRoot = resolve(cwd);
  if (!isWithinDirectory(allowedRoot, absolutePath)) {
    const parts = relative(resolve(visualizationRoot), absolutePath).split(sep);
    if (parts.length < 5 || !/^\d{4}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])
        || !/^\d{2}$/.test(parts[2]) || parts[3] !== thread.id
        || !/^[a-zA-Z0-9-]+$/.test(thread.id)) {
      throw new LocalFileRequestError(403, "图文件不在当前对话的可视化目录中");
    }
    allowedRoot = resolve(visualizationRoot, ...parts.slice(0, 4));
  }
  let target, root, visualRoot;
  try {
    [target, root] = await Promise.all([realpath(absolutePath), realpath(allowedRoot)]);
    if (allowedRoot !== resolve(cwd)) visualRoot = await realpath(visualizationRoot);
  } catch {
    throw new LocalFileRequestError(404, "图文件不存在，原文件可能已移动或删除");
  }
  if (!isWithinDirectory(root, target) || (visualRoot &&
      root !== resolve(visualRoot, relative(resolve(visualizationRoot), allowedRoot)))) {
    throw new LocalFileRequestError(403, "图文件链接指向允许目录之外");
  }
  const details = await stat(target);
  if (!details.isFile()) throw new LocalFileRequestError(404, "图路径不是普通文件");
  if (details.size > MAX_VISUALIZATION_BYTES) throw new LocalFileRequestError(413, "图文件过大（上限 1 MB）");
  const source = await readFile(target, "utf8");
  if (Buffer.byteLength(source) > MAX_VISUALIZATION_BYTES) throw new LocalFileRequestError(413, "图文件过大");
  return source;
}

function sendVisualization(response, status, contents) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": VISUALIZATION_CSP,
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(contents);
}

function pathApiFor(platform = process.platform) {
  return platform === "win32" ? win32 : posix;
}

export function nativePathFromRequest(requestedPath, platform = process.platform) {
  if (platform !== "win32") {
    return requestedPath;
  }

  // URL pathnames have a leading slash before a Windows drive letter. The
  // file endpoint accepts an already-decoded URL form and native backslash
  // paths. HTTP/URL parsing decodes each layer exactly once before this call.
  const withoutUrlSlash = requestedPath.replace(/^\/(?=[A-Za-z]:[\\/])/, "");
  return win32.normalize(withoutUrlSlash.replaceAll("/", "\\"));
}

export function normalizeLocalFileRequest(requestedPath, platform = process.platform) {
  if (typeof requestedPath !== "string") {
    return requestedPath;
  }
  return nativePathFromRequest(requestedPath, platform);
}

function isLaunchPathRequest(requestedPath, launchPath, platform = process.platform) {
  return isWithinDirectory(launchPath, requestedPath, platform);
}

class LocalFileRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isWithinDirectory(root, target, platform = process.platform) {
  const pathApi = pathApiFor(platform);
  const relativePath = pathApi.relative(root, target);
  return relativePath === ""
    || (!relativePath.startsWith(`..${pathApi.sep}`)
      && relativePath !== ".."
      && !pathApi.isAbsolute(relativePath));
}

export function localFileCandidates(requestedPath) {
  const candidates = [{ path: requestedPath, line: null }];
  // Codex file links may append a line or line/column suffix to an absolute path.
  const lineMatch = requestedPath.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (lineMatch && lineMatch[1]) {
    candidates.push({ path: lineMatch[1], line: Number(lineMatch[2]) });
  }
  return candidates;
}

export async function resolveLocalFile(
  cwd,
  requestedPath,
  { platform = process.platform } = {},
) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new LocalFileRequestError(400, "A local file path is required");
  }

  let root;
  try {
    root = await realpath(cwd);
  } catch {
    throw new LocalFileRequestError(404, "Local file not found");
  }

  const pathApi = pathApiFor(platform);
  for (const candidate of localFileCandidates(requestedPath.trim())) {
    const nativeCandidatePath = nativePathFromRequest(candidate.path, platform);
    const absolutePath = pathApi.isAbsolute(nativeCandidatePath)
      ? pathApi.resolve(nativeCandidatePath)
      : pathApi.resolve(root, nativeCandidatePath);
    let target;
    try {
      target = await realpath(absolutePath);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EINVAL"].includes(error.code)) {
        continue;
      }
      throw new LocalFileRequestError(403, "Local file cannot be read");
    }

    if (!isWithinDirectory(root, target, platform)) {
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

function localFileHeaders(filePath, size, platform = process.platform) {
  const fileName = pathApiFor(platform).basename(filePath).replace(/["\\\r\n]/g, "_") || "file";
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

async function sendLocalFile(response, file, platform = process.platform) {
  let contents;
  try {
    contents = await readFile(file.path);
  } catch {
    throw new LocalFileRequestError(403, "Local file cannot be read");
  }
  response.writeHead(200, localFileHeaders(file.path, contents.byteLength, platform));
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

export function browserInvocation(
  url,
  { platform = process.platform, env = process.env } = {},
) {
  let command;
  let args;
  let options = {
    detached: true,
    stdio: "ignore",
    shell: false,
  };

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = env?.ComSpec || env?.COMSPEC || "cmd.exe";
    args = ["/c", "start", "", url];
    options = { ...options, windowsHide: true };
  } else if (env?.WSL_DISTRO_NAME) {
    command = "cmd.exe";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  return { command, args, options };
}

export function openInBrowser(
  url,
  { platform = process.platform, env = process.env, spawnProcess = spawn } = {},
) {
  const invocation = browserInvocation(url, { platform, env });

  try {
    const child = spawnProcess(
      invocation.command,
      invocation.args,
      invocation.options,
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    // The printed URL remains the reliable fallback.
  }
}

export function parseCliArgs(args, { platform = process.platform } = {}) {
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
      options.cwd = pathApiFor(platform).resolve(cwd);
      index += 1;
    } else if (argument === "--port") {
      const port = args[index + 1];
      if (!/^\d+$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535) {
        throw new Error("--port requires an integer between 1 and 65535");
      }
      options.port = Number(port);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

/**
 * Notify a parent launcher when this process was started with Node's IPC
 * channel. Foreground invocations do not expose `process.send`, so they keep
 * the existing stdout and signal-handling behavior unchanged.
 */
export function notifyParent(message, processLike = process) {
  if (typeof processLike?.send !== "function") {
    return false;
  }

  try {
    processLike.send(message);
    return true;
  } catch {
    // The launcher may have already disconnected after receiving readiness.
    return false;
  }
}

export async function createNavigatorServer({
  client,
  cwd,
  webRoot = fileURLToPath(new URL("../assets/web/", import.meta.url)),
  idleMs = 30 * 60_000,
  openUrl = true,
  platform = process.platform,
  port = 0,
  visualizationRoot = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"), "visualizations"),
}) {
  let closed = false;
  let lastActivity = Date.now();
  let idleTimer = null;
  const threadSnapshots = new Map();
  function rememberThread(thread) {
    threadSnapshots.delete(thread.id);
    threadSnapshots.set(thread.id, { thread, time: Date.now() });
    if (threadSnapshots.size > 8) threadSnapshots.delete(threadSnapshots.keys().next().value);
    return thread;
  }

  // Register an exact allowlist of bundled math assets, including font files.
  const staticFiles = new Map(STATIC_FILES);
  const katexRoot = resolve(webRoot, "vendor/katex");
  for (const [name, type] of [
    ["katex.mjs", "text/javascript; charset=utf-8"],
    ["katex.min.css", "text/css; charset=utf-8"],
  ]) {
    staticFiles.set(`/vendor/katex/${name}`, [`vendor/katex/${name}`, type]);
  }
  const fonts = await readdir(resolve(katexRoot, "fonts")).catch(() => []);
  for (const name of fonts) {
    if (/^KaTeX_[A-Za-z0-9_-]+\.woff2$/.test(name)) {
      staticFiles.set(`/vendor/katex/fonts/${name}`, [`vendor/katex/fonts/${name}`, "font/woff2"]);
    }
  }

  const server = createServer(async (request, response) => {
    lastActivity = Date.now();
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        if (requestUrl.pathname === "/api/visualization") {
          try {
            const threadId = requestUrl.searchParams.get("thread");
            if (!/^[a-zA-Z0-9-]{1,100}$/.test(threadId ?? "")) {
              throw new LocalFileRequestError(400, "缺少有效的对话 ID");
            }
            const cached = threadSnapshots.get(threadId);
            const thread = cached && Date.now() - cached.time < 5000
              ? cached.thread : rememberThread(await client.readThread(threadId));
            const source = await readVisualization({ cwd, visualizationRoot, thread,
              requestedPath: requestUrl.searchParams.get("path") });
            sendVisualization(response, 200, visualizationDocument(source));
          } catch (error) {
            const status = error instanceof LocalFileRequestError ? error.status : 500;
            sendVisualization(response, status, visualizationErrorDocument(
              error instanceof LocalFileRequestError ? error.message : "读取图文件失败"));
          }
          return;
        }
        if (requestUrl.pathname === "/api/local-file") {
          try {
            const file = await resolveLocalFile(
              cwd,
              requestUrl.searchParams.get("path"),
              { platform },
            );
            await sendLocalFile(response, file, platform);
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
          const thread = rememberThread(await client.readThread(decodeURIComponent(match[1])));
          sendJson(response, 200, { thread: projectThread(thread) });
          return;
        }

        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const staticFile = staticFiles.get(requestUrl.pathname);
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
        const launchPath = pathApiFor(platform).resolve(cwd);
        const nativeRequestedPath = nativePathFromRequest(requestedPath, platform);
        if (isLaunchPathRequest(nativeRequestedPath, launchPath, platform)) {
          try {
            await resolveLocalFile(cwd, nativeRequestedPath, { platform });
            redirectToLocalFileViewer(response, requestUrl, nativeRequestedPath);
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
      const contents = await readFile(pathApiFor(platform).resolve(webRoot, fileName));
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
    server.listen(port, "127.0.0.1", () => {
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
    openInBrowser(url, { platform });
  }

  return { url, close };
}

async function runCli() {
  let client;
  let navigator;

  try {
    const options = parseCliArgs(process.argv.slice(2));
    client = new AppServerClient();
    await client.start();
    navigator = await createNavigatorServer({ client, ...options });
    notifyParent({
      type: "ready",
      url: navigator.url,
      pid: process.pid,
    });
    console.log(`Conversation Navigator: ${navigator.url}`);
  } catch (error) {
    client?.stop();
    const message = error instanceof Error ? error.message : String(error);
    notifyParent({ type: "error", message });
    console.error(message);
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

const isCli = isMainModule(import.meta.url);
if (isCli) {
  await runCli();
}
