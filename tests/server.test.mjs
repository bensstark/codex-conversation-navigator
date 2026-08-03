import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createNavigatorServer,
  parseCliArgs,
} from "../skill/conversation-navigator/scripts/server.mjs";

const rawThread = {
  id: "thread-1",
  name: "Runtime",
  preview: "Explain run",
  updatedAt: 42,
  source: "vscode",
  turns: [
    {
      id: "turn-1",
      items: [
        {
          type: "userMessage",
          id: "user-1",
          content: [{ type: "text", text: "Explain run()" }],
        },
      ],
    },
  ],
};

async function createWebRoot(t) {
  const directory = await mkdtemp(join(tmpdir(), "conversation-navigator-"));
  const vendorDirectory = join(directory, "vendor");
  await mkdir(vendorDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "index.html"), "<html>navigator</html>"),
    writeFile(join(directory, "app.js"), "console.log('navigator')"),
    writeFile(join(directory, "style.css"), "body{}"),
    writeFile(join(directory, "markdown.js"), "export function renderMarkdown() {}"),
    writeFile(join(vendorDirectory, "marked.esm.js"), "export const marked = {};"),
    writeFile(join(vendorDirectory, "purify.es.mjs"), "export default () => ({});"),
    writeFile(join(vendorDirectory, "highlight.min.js"), "export default {};"),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function createFakeClient({ readError } = {}) {
  const cliThread = {
    ...rawThread,
    id: "thread-cli",
    name: "CLI Runtime",
    source: "cli",
  };
  return {
    stopped: 0,
    listCalls: [],
    async listThreads(cwd, sourceKinds) {
      assert.equal(cwd, "/repo");
      this.listCalls.push(sourceKinds);
      return [rawThread, cliThread].filter((thread) => sourceKinds.includes(thread.source));
    },
    async readThread(threadId) {
      assert.equal(threadId, "thread-1");
      if (readError) {
        throw readError;
      }
      return rawThread;
    },
    stop() {
      this.stopped += 1;
    },
  };
}

function apiUrl(base, path) {
  return new URL(path, base).toString();
}

test("serves static assets and thread APIs without authentication", async (t) => {
  const webRoot = await createWebRoot(t);
  const client = createFakeClient();
  const navigator = await createNavigatorServer({
    client,
    cwd: "/repo",
    webRoot,
    idleMs: 0,
    openUrl: false,
  });
  t.after(() => navigator.close());

  assert.equal(new URL(navigator.url).hash, "");

  const index = await fetch(apiUrl(navigator.url, "/"));
  assert.equal(index.status, 200);
  assert.equal(await index.text(), "<html>navigator</html>");
  assert.equal(index.headers.get("referrer-policy"), "no-referrer");
  assert.match(index.headers.get("content-security-policy"), /default-src 'self'/);
  const policy = index.headers.get("content-security-policy");
  assert.match(policy, /img-src 'self' data: http: https:/);
  assert.match(policy, /media-src 'none'/);
  assert.match(policy, /frame-src 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /form-action 'none'/);

  const markdown = await fetch(apiUrl(navigator.url, "/markdown.js"));
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get("content-type"), /^text\/javascript/);
  assert.equal(markdown.headers.get("referrer-policy"), "no-referrer");

  for (const path of ["/app.js", "/style.css"]) {
    const asset = await fetch(apiUrl(navigator.url, path));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("referrer-policy"), "no-referrer");
  }

  const marked = await fetch(apiUrl(navigator.url, "/vendor/marked.esm.js"));
  assert.equal(marked.status, 200);
  assert.match(marked.headers.get("content-type"), /^text\/javascript/);
  assert.equal(marked.headers.get("referrer-policy"), "no-referrer");

  const purify = await fetch(apiUrl(navigator.url, "/vendor/purify.es.mjs"));
  assert.equal(purify.status, 200);
  assert.match(purify.headers.get("content-type"), /^text\/javascript/);
  assert.equal(purify.headers.get("referrer-policy"), "no-referrer");

  const highlight = await fetch(apiUrl(navigator.url, "/vendor/highlight.min.js"));
  assert.equal(highlight.status, 200);
  assert.match(highlight.headers.get("content-type"), /^text\/javascript/);
  assert.equal(highlight.headers.get("referrer-policy"), "no-referrer");

  const unlistedVendorFile = await fetch(
    apiUrl(navigator.url, "/vendor/DOMPURIFY-LICENSE"),
  );
  assert.equal(unlistedVendorFile.status, 404);

  const threads = await fetch(apiUrl(navigator.url, "/api/threads"));
  assert.equal(threads.status, 200);
  assert.deepEqual(await threads.json(), {
    cwd: "/repo",
    threads: [
      {
        id: "thread-1",
        name: "Runtime",
        preview: "Explain run",
        updatedAt: 42,
        source: "vscode",
      },
      {
        id: "thread-cli",
        name: "CLI Runtime",
        preview: "Explain run",
        updatedAt: 42,
        source: "cli",
      },
    ],
  });
  assert.deepEqual(client.listCalls[0], ["vscode", "cli"]);

  const cliThreads = await fetch(apiUrl(navigator.url, "/api/threads?source=cli"));
  assert.equal(cliThreads.status, 200);
  assert.deepEqual((await cliThreads.json()).threads.map(({ source }) => source), ["cli"]);
  assert.deepEqual(client.listCalls[1], ["cli"]);

  const invalidSource = await fetch(apiUrl(navigator.url, "/api/threads?source=desktop"));
  assert.equal(invalidSource.status, 400);
  assert.deepEqual(await invalidSource.json(), { error: "Invalid source filter" });

  const thread = await fetch(apiUrl(navigator.url, "/api/threads/thread-1"));
  assert.equal(thread.status, 200);
  assert.equal((await thread.json()).thread.navigation[0].text, "Explain run()");

  const missing = await fetch(apiUrl(navigator.url, "/missing"));
  assert.equal(missing.status, 404);
});

test("returns App Server errors without exposing a stack", async (t) => {
  const webRoot = await createWebRoot(t);
  const navigator = await createNavigatorServer({
    client: createFakeClient({ readError: new Error("read failed") }),
    cwd: "/repo",
    webRoot,
    idleMs: 0,
    openUrl: false,
  });
  t.after(() => navigator.close());

  const response = await fetch(apiUrl(navigator.url, "/api/threads/thread-1"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "read failed" });
});

test("serves local file links only from the launch directory", async (t) => {
  const webRoot = await createWebRoot(t);
  const workspace = await mkdtemp(join(tmpdir(), "conversation-navigator-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "conversation-navigator-outside-"));
  const localFile = join(workspace, "src.js");
  const outsideFile = join(outside, "secret.txt");
  await Promise.all([
    writeFile(localFile, "const first = 1;\nconst second = 2;\n"),
    writeFile(outsideFile, "outside\n"),
  ]);
  t.after(async () => {
    await Promise.all([
      rm(workspace, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });

  const navigator = await createNavigatorServer({
    client: createFakeClient(),
    cwd: workspace,
    webRoot,
    idleMs: 0,
    openUrl: false,
  });
  t.after(() => navigator.close());

  const endpoint = await fetch(apiUrl(
    navigator.url,
    `/api/local-file?path=${encodeURIComponent(`${localFile}:2`)}`,
  ));
  assert.equal(endpoint.status, 200);
  assert.match(endpoint.headers.get("content-type"), /^text\/plain/);
  assert.match(endpoint.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(await endpoint.text(), "const first = 1;\nconst second = 2;\n");

  const absoluteLink = await fetch(apiUrl(navigator.url, `${localFile}:1`));
  assert.equal(absoluteLink.status, 200);
  assert.equal(await absoluteLink.text(), "const first = 1;\nconst second = 2;\n");

  const outsideResponse = await fetch(apiUrl(
    navigator.url,
    `/api/local-file?path=${encodeURIComponent(outsideFile)}`,
  ));
  assert.equal(outsideResponse.status, 403);
  assert.deepEqual(await outsideResponse.json(), {
    error: "Local file is outside the launch directory",
  });
});

test("close is idempotent and stops App Server once", async (t) => {
  const webRoot = await createWebRoot(t);
  const client = createFakeClient();
  const navigator = await createNavigatorServer({
    client,
    cwd: "/repo",
    webRoot,
    idleMs: 0,
    openUrl: false,
  });

  await navigator.close();
  await navigator.close();
  assert.equal(client.stopped, 1);
});

test("closes after the configured idle timeout", async (t) => {
  const webRoot = await createWebRoot(t);
  const client = createFakeClient();
  const navigator = await createNavigatorServer({
    client,
    cwd: "/repo",
    webRoot,
    idleMs: 20,
    openUrl: false,
  });
  t.after(() => navigator.close());

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(client.stopped, 1);
});

test("parses CLI arguments", () => {
  assert.deepEqual(parseCliArgs(["--cwd", "/repo", "--no-open"]), {
    cwd: "/repo",
    openUrl: false,
  });
  assert.throws(() => parseCliArgs(["--cwd"]), /requires a path/);
  assert.throws(() => parseCliArgs(["--unknown"]), /Unknown argument/);
  assert.throws(() => parseCliArgs(["--no-auth"]), /Unknown argument/);
});
