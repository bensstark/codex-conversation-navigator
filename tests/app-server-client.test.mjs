import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import { AppServerClient } from "../skill/conversation-navigator/scripts/app-server-client.mjs";

function createFakeProcess(onMessage) {
  const child = new EventEmitter();
  const requests = [];
  let input = "";

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      input += chunk.toString();
      let newline;
      while ((newline = input.indexOf("\n")) !== -1) {
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        const message = JSON.parse(line);
        requests.push(message);
        queueMicrotask(() => onMessage?.(message, child));
      }
      callback();
    },
  });
  child.kill = () => {
    child.killed = true;
  };

  return {
    child,
    requests,
    respond(id, result) {
      child.stdout.write(`${JSON.stringify({ id, result })}\n`);
    },
    respondWithError(id, message) {
      child.stdout.write(
        `${JSON.stringify({ id, error: { code: -1, message } })}\n`,
      );
    },
  };
}

test("initializes and reads VS Code threads", async () => {
  let fake;
  fake = createFakeProcess((message) => {
    if (message.method === "initialize") {
      fake.respond(message.id, { userAgent: "test" });
    } else if (message.method === "thread/list") {
      fake.respond(message.id, { data: [{ id: "thread-1" }] });
    } else if (message.method === "thread/read") {
      fake.respond(message.id, { thread: { id: "thread-1", turns: [] } });
    }
  });

  const client = new AppServerClient({ spawnProcess: () => fake.child });
  await client.start();

  assert.deepEqual(await client.listThreads("/repo"), [{ id: "thread-1" }]);
  assert.deepEqual(await client.readThread("thread-1"), {
    id: "thread-1",
    turns: [],
  });
  assert.deepEqual(
    fake.requests.filter(({ id }) => id !== undefined).map(({ method }) => method),
    ["initialize", "thread/list", "thread/read"],
  );
  assert.deepEqual(fake.requests[1], {
    method: "initialized",
  });
  assert.deepEqual(fake.requests[2].params, {
    cwd: "/repo",
    sourceKinds: ["vscode"],
    sortKey: "updated_at",
    sortDirection: "desc",
  });

  client.stop();
  assert.equal(fake.child.killed, true);
});

test("rejects App Server error responses", async () => {
  let fake;
  fake = createFakeProcess((message) => {
    if (message.method === "initialize") {
      fake.respond(message.id, {});
    } else if (message.method === "explode") {
      fake.respondWithError(message.id, "boom");
    }
  });

  const client = new AppServerClient({ spawnProcess: () => fake.child });
  await client.start();

  await assert.rejects(client.request("explode"), /boom/);
  client.stop();
});

test("rejects pending requests after malformed output", async () => {
  let fake;
  fake = createFakeProcess((message) => {
    if (message.method === "initialize") {
      fake.respond(message.id, {});
    }
  });

  const client = new AppServerClient({ spawnProcess: () => fake.child });
  await client.start();
  const pending = client.request("slow");
  fake.child.stdout.write("not-json\n");

  await assert.rejects(pending, /Invalid JSON from Codex App Server/);
  client.stop();
});

test("rejects pending requests when App Server exits", async () => {
  let fake;
  fake = createFakeProcess((message) => {
    if (message.method === "initialize") {
      fake.respond(message.id, {});
    }
  });

  const client = new AppServerClient({ spawnProcess: () => fake.child });
  await client.start();
  const pending = client.request("slow");
  fake.child.emit("exit", 2, null);

  await assert.rejects(pending, /exited with code 2/);
});

test("reports a missing Codex executable", async () => {
  const fake = createFakeProcess();
  const client = new AppServerClient({ spawnProcess: () => fake.child });
  const started = client.start();
  fake.child.emit("error", Object.assign(new Error("spawn codex ENOENT"), {
    code: "ENOENT",
  }));

  await assert.rejects(
    started,
    /Unable to start Codex App Server: spawn codex ENOENT/,
  );
});
