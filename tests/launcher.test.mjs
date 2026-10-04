import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getLaunchStatePath,
  launchServer,
  launchStatePath,
  parseLauncherArgs,
  serverInvocation,
  writeLaunchState,
} from "../skill/conversation-navigator/scripts/launch.mjs";

class FakeChild extends EventEmitter {
  constructor(pid = 4242) {
    super();
    this.pid = pid;
    this.connected = true;
    this.disconnectCalls = 0;
    this.unrefCalls = 0;
    this.killCalls = 0;
    this.killed = false;
  }

  disconnect() {
    this.connected = false;
    this.disconnectCalls += 1;
  }

  unref() {
    this.unrefCalls += 1;
  }

  kill() {
    this.killed = true;
    this.killCalls += 1;
  }
}

test("launcher keeps Windows paths as one shell-free argv value", () => {
  const project = "C:\\Users\\Ada Lovelace\\Conversation Navigator";
  const invocation = serverInvocation({
    cwd: project,
    noOpen: true,
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    serverPath: "C:\\Program Files\\navigator\\server.mjs",
  });

  assert.deepEqual(invocation.args, [
    "C:\\Program Files\\navigator\\server.mjs",
    "--cwd",
    project,
    "--no-open",
  ]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.detached, true);
  assert.equal(invocation.options.windowsHide, true);
  assert.deepEqual(invocation.options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
});

test("launcher parses --no-open and forwards the exact project path", () => {
  const project = "C:\\Users\\Ada Lovelace\\repo";
  assert.deepEqual(parseLauncherArgs(["--cwd", project, "--no-open"]), {
    cwd: project,
    openUrl: false,
  });
  assert.throws(() => parseLauncherArgs(["--cwd"]), /requires a path/);
  assert.throws(() => parseLauncherArgs(["--unexpected"]), /Unknown argument/);
});

test("launcher writes UTF-8 ready and error state records in a created directory", async (t) => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "conversation-navigator-state-"));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));

  const readyPath = await writeLaunchState({
    status: "ready",
    url: "http://127.0.0.1:43123/",
    pid: 4242,
    cwd: "C:\\Users\\Ada Lovelace\\repo",
    updatedAt: "2026-08-09T00:00:00.000Z",
  }, { tempDirectory });
  assert.equal(readyPath, launchStatePath(tempDirectory));
  assert.equal(readyPath, getLaunchStatePath(tempDirectory));
  const readyRaw = await readFile(readyPath, "utf8");
  assert.match(readyRaw, /\n$/);
  assert.deepEqual(JSON.parse(readyRaw), {
    status: "ready",
    url: "http://127.0.0.1:43123/",
    pid: 4242,
    cwd: "C:\\Users\\Ada Lovelace\\repo",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });

  const errorPath = await writeLaunchState({
    status: "error",
    message: "codex 不可用",
    cwd: "C:\\Users\\Ada Lovelace\\repo",
  }, { tempDirectory });
  const errorRecord = JSON.parse(await readFile(errorPath, "utf8"));
  assert.equal(errorRecord.status, "error");
  assert.equal(errorRecord.message, "codex 不可用");
  assert.equal(errorRecord.cwd, "C:\\Users\\Ada Lovelace\\repo");
  assert.match(errorRecord.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("launcher prints no long-running output and resolves on ready IPC", async () => {
  let child;
  let invocation;
  const result = await launchServer({
    cwd: "C:\\Users\\Ada Lovelace\\repo",
    noOpen: true,
    timeoutMs: 1_000,
    spawnProcess(command, args, options) {
      child = new FakeChild();
      invocation = { command, args, options };
      queueMicrotask(() => child.emit("message", {
        type: "ready",
        url: "http://127.0.0.1:43123/",
        pid: child.pid,
      }));
      return child;
    },
  });

  assert.equal(result.url, "http://127.0.0.1:43123/");
  assert.equal(result.pid, 4242);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.args.slice(-2), ["C:\\Users\\Ada Lovelace\\repo", "--no-open"]);
  assert.equal(child.disconnectCalls, 0);
  assert.equal(child.unrefCalls, 0);
  assert.equal(child.killCalls, 0);

  result.release();
  result.release();
  assert.equal(child.disconnectCalls, 1);
  assert.equal(child.unrefCalls, 1);
});

test("launcher reports structured startup errors", async () => {
  await assert.rejects(
    launchServer({
      timeoutMs: 1_000,
      spawnProcess() {
        const child = new FakeChild();
        queueMicrotask(() => child.emit("message", {
          type: "error",
          message: "codex was not found",
        }));
        return child;
      },
    }),
    /Conversation Navigator failed to start: codex was not found/,
  );
});

test("launcher reports synchronous spawn failures", async () => {
  await assert.rejects(
    launchServer({
      spawnProcess() {
        throw new Error("spawn ENOENT");
      },
    }),
    /Unable to launch Conversation Navigator: spawn ENOENT/,
  );
});

test("launcher reports early child exit", async () => {
  await assert.rejects(
    launchServer({
      timeoutMs: 1_000,
      spawnProcess() {
        const child = new FakeChild();
        queueMicrotask(() => child.emit("exit", 17, null));
        return child;
      },
    }),
    /exited before ready \(code 17\)/,
  );
});

test("launcher reports a configurable readiness timeout and cleans up", async () => {
  let child;
  await assert.rejects(
    launchServer({
      timeoutMs: 10,
      spawnProcess() {
        child = new FakeChild();
        return child;
      },
    }),
    /Timed out after 10ms waiting for Conversation Navigator to become ready/,
  );
  assert.equal(child.killCalls, 1);
  assert.equal(child.disconnectCalls, 1);
  assert.equal(child.unrefCalls, 1);
});
