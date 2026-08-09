import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_SCRIPT = fileURLToPath(new URL("./server.mjs", import.meta.url));
const DEFAULT_READY_TIMEOUT_MS = 15_000;

/**
 * Return the shared machine-readable status location used by the launcher.
 * Accept either a temp-directory string or an options object for simple
 * unit-test injection without changing the production path.
 */
export function launchStatePath(tempDirectory = tmpdir()) {
  const baseDirectory = typeof tempDirectory === "string"
    ? tempDirectory
    : tempDirectory?.tempDirectory ?? tmpdir();
  return join(baseDirectory, "codex-conversation-navigator", "last-launch.json");
}

export const getLaunchStatePath = launchStatePath;

/**
 * Persist one UTF-8 JSON launch record, creating the parent directory first.
 * The filesystem functions and destination are injectable for deterministic
 * tests; normal calls always use the fixed path under the OS temp directory.
 */
export async function writeLaunchState(
  state,
  {
    tempDirectory = tmpdir(),
    statePath,
    mkdirProcess = mkdir,
    writeFileProcess = writeFile,
  } = {},
) {
  const destination = statePath ?? launchStatePath(tempDirectory);
  const record = {
    ...state,
    updatedAt: state?.updatedAt ?? new Date().toISOString(),
  };
  await mkdirProcess(dirname(destination), { recursive: true });
  await writeFileProcess(destination, `${JSON.stringify(record)}\n`, "utf8");
  return destination;
}

/**
 * Parse launcher-only arguments without ever joining user paths into a shell
 * command. The server receives the same path as one argv element.
 */
export function parseLauncherArgs(args, { cwd = process.cwd() } = {}) {
  const options = {
    cwd,
    openUrl: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-open") {
      options.openUrl = false;
      continue;
    }
    if (argument === "--cwd") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--cwd requires a path");
      }
      options.cwd = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

/**
 * Describe the detached child invocation. Keeping command and argv separate
 * is important on Windows: a project path containing spaces must not be
 * reparsed by cmd.exe.
 */
export function serverInvocation({
  cwd = process.cwd(),
  noOpen = false,
  nodePath = process.execPath,
  serverPath = SERVER_SCRIPT,
} = {}) {
  const args = [serverPath, "--cwd", cwd];
  if (noOpen) {
    args.push("--no-open");
  }

  return {
    command: nodePath,
    args,
    options: {
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  };
}

function removeListener(child, event, listener) {
  if (typeof child.off === "function") {
    child.off(event, listener);
  } else if (typeof child.removeListener === "function") {
    child.removeListener(event, listener);
  }
}

function disconnectChild(child) {
  if (typeof child.disconnect !== "function") {
    return;
  }
  try {
    if (child.connected !== false) {
      child.disconnect();
    }
  } catch {
    // The child may have exited between readiness and cleanup.
  }
}

function unrefChild(child) {
  if (typeof child.unref === "function") {
    child.unref();
  }
}

function terminateChild(child) {
  if (typeof child.kill !== "function" || child.killed) {
    return;
  }
  try {
    child.kill();
  } catch {
    // A child that already exited does not need further cleanup.
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Start the server, wait for its structured IPC readiness message, and then
 * release the launcher from the long-running child. The timeout and spawn
 * function are injectable so tests never need a real browser or service.
 */
export async function launchServer({
  cwd = process.cwd(),
  noOpen = false,
  spawnProcess = spawn,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  nodePath = process.execPath,
  serverPath = SERVER_SCRIPT,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("timeoutMs must be a non-negative finite number");
  }

  const invocation = serverInvocation({
    cwd,
    noOpen,
    nodePath,
    serverPath,
  });

  let child;
  try {
    child = spawnProcess(
      invocation.command,
      invocation.args,
      invocation.options,
    );
  } catch (error) {
    throw new Error(`Unable to launch Conversation Navigator: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  if (!child || typeof child.on !== "function") {
    throw new Error("Unable to launch Conversation Navigator: spawn returned no child process");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let released = false;
    let timer;
    const listeners = [];

    const addListener = (event, listener) => {
      child.on(event, listener);
      listeners.push([event, listener]);
    };

    const cleanupListeners = () => {
      for (const [event, listener] of listeners) {
        removeListener(child, event, listener);
      }
      listeners.length = 0;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };

    // Keep the child and IPC channel referenced until the caller has written
    // the URL/PID. Releasing them in the ready handler can let a short-lived
    // launcher exit before stdout's write callback runs on Windows.
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      disconnectChild(child);
      unrefChild(child);
    };

    const finish = (error, ready) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupListeners();

      if (error) {
        terminateChild(child);
        release();
      }

      if (error) {
        reject(error);
      } else {
        resolve({
          url: ready.url,
          pid: child.pid ?? ready.pid,
          child,
          invocation,
          release,
        });
      }
    };

    addListener("message", (message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "ready") {
        if (typeof message.url !== "string" || !message.url) {
          finish(new Error("Conversation Navigator sent an invalid ready message"));
          return;
        }
        finish(null, message);
        return;
      }

      if (message.type === "error") {
        const detail = message.message
          ?? (typeof message.error === "string" ? message.error : message.error?.message)
          ?? "unknown startup error";
        finish(new Error(`Conversation Navigator failed to start: ${detail}`));
      }
    });

    addListener("error", (error) => {
      finish(new Error(`Unable to launch Conversation Navigator: ${errorMessage(error)}`, {
        cause: error,
      }));
    });

    addListener("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      finish(new Error(`Conversation Navigator exited before ready (${detail})`));
    });

    addListener("disconnect", () => {
      finish(new Error("Conversation Navigator IPC channel closed before ready"));
    });

    timer = setTimeout(() => {
      finish(new Error(
        `Timed out after ${timeoutMs}ms waiting for Conversation Navigator to become ready`,
      ));
    }, timeoutMs);

    // Keep the launcher alive until readiness or a clear timeout; the timer is
    // cleared as soon as the detached child reports its result.
  });
}

async function runCli() {
  let launchCwd = process.cwd();
  let launched;

  try {
    const options = parseLauncherArgs(process.argv.slice(2));
    launchCwd = resolve(options.cwd);
    launched = await launchServer({
      cwd: options.cwd,
      noOpen: !options.openUrl,
    });

    // Write the fallback record before stdout. Some terminal wrappers hide
    // direct output whenever a detached grandchild is detected; a later,
    // independent PowerShell command can still read this deterministic file.
    await writeLaunchState({
      status: "ready",
      url: launched.url,
      pid: launched.pid,
      cwd: launchCwd,
    });
    await writeStdoutLine(`Conversation Navigator: ${launched.url}`);
    await writeStdoutLine(`Conversation Navigator PID: ${launched.pid}`);
  } catch (error) {
    await writeLaunchState({
      status: "error",
      message: errorMessage(error),
      cwd: launchCwd,
    }).catch(() => {
      // State is a best-effort diagnostic fallback; preserve the startup error.
    });
    console.error(errorMessage(error));
    process.exitCode = 1;
  } finally {
    launched?.release();
  }
}

function writeStdoutLine(line) {
  return new Promise((resolve, reject) => {
    try {
      process.stdout.write(`${line}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

const isCli = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  await runCli();
}
