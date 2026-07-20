# Conversation Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build and install a read-only personal Codex skill that opens a local two-pane viewer for navigating VS Code conversation history by user message.

**Architecture:** A dependency-free Node.js launcher spawns codex app-server over stdio and exposes a token-protected loopback HTTP API. A vanilla browser UI projects App Server threads into a searchable outline and transcript, while the skill supplies the repeatable launch workflow.

**Tech Stack:** Node.js 20+ built-ins, node:test, Codex App Server JSON-RPC, vanilla HTML/CSS/JavaScript, Codex Skill metadata.

## Global Constraints

- Keep the service read-only; expose no thread mutation operation.
- Bind only to 127.0.0.1 on an OS-assigned port.
- Do not read auth.json or send transcript data externally.
- Use no third-party runtime or test dependencies.
- Render transcript content with textContent, never innerHTML.
- Select VS Code threads by exact cwd and newest updated_at first.
- Do not modify or control the official Codex VS Code extension.

---

## File Map

- package.json: project metadata and test command.
- tests/transcript.test.mjs: pure transcript projection.
- tests/app-server-client.test.mjs: JSON-RPC lifecycle.
- tests/server.test.mjs: HTTP authentication and API.
- tests/web-assets.test.mjs: browser UI contract.
- skill/conversation-navigator/SKILL.md: launch workflow.
- skill/conversation-navigator/agents/openai.yaml: skill UI metadata.
- skill/conversation-navigator/scripts/transcript.mjs: pure thread projection.
- skill/conversation-navigator/scripts/app-server-client.mjs: stdio client.
- skill/conversation-navigator/scripts/server.mjs: HTTP service and CLI.
- skill/conversation-navigator/assets/web/: browser UI assets.

---

### Task 1: Skill Scaffold and Transcript Projection

**Files:**
- Create: package.json
- Create: skill/conversation-navigator/ with the skill initializer
- Create: skill/conversation-navigator/scripts/transcript.mjs
- Test: tests/transcript.test.mjs

**Interfaces:**
- Consumes: App Server Thread objects containing turns[].items[].
- Produces: inputToText(input) and projectThread(thread).
- ProjectedThread contains id, name, preview, updatedAt, turns, and navigation.

- [ ] **Step 1: Initialize the skill and metadata**

Run:

~~~bash
python3 /home/user/.codex/skills/.system/skill-creator/scripts/init_skill.py conversation-navigator \
  --path /home/user/codex-conversation-navigator/skill \
  --resources scripts,assets \
  --interface display_name='Conversation Navigator' \
  --interface short_description='Browse local Codex conversations by user message' \
  --interface default_prompt='Use $conversation-navigator to open a read-only navigator for this project.'
~~~

Create package.json with type module, Node >=20, and test script node --test.

- [ ] **Step 2: Write failing projection tests**

Test these exact cases:

~~~js
assert.equal(inputToText({ type: "text", text: "<b>hello</b>" }), "<b>hello</b>");
assert.equal(inputToText({ type: "skill", name: "review" }), "$review");
assert.equal(inputToText({ type: "mention", name: "src/main.rs" }), "@src/main.rs");
assert.equal(inputToText({ type: "localImage", path: "/tmp/a.png" }), "[Local image: /tmp/a.png]");
assert.equal(inputToText({ type: "image", url: "data:image/png;base64,x" }), "[Image]");
~~~

Build a thread with one userMessage, one reasoning item, and one agentMessage. Assert projectThread creates one navigation entry, excludes reasoning, and keeps the user and assistant text.

- [ ] **Step 3: Verify the tests fail**

Run: npm test -- tests/transcript.test.mjs

Expected: FAIL because transcript.mjs does not exist.

- [ ] **Step 4: Implement the minimal projection**

Use this public shape:

~~~js
export function inputToText(input) {
  switch (input?.type) {
    case "text": return input.text;
    case "skill": return "$" + input.name;
    case "mention": return "@" + input.name;
    case "localImage": return "[Local image: " + input.path + "]";
    case "image": return "[Image]";
    default: return "[" + (input?.type ?? "Unknown input") + "]";
  }
}

export function projectThread(thread) {
  // Keep userMessage and non-empty agentMessage items only.
  // Create one navigation entry per userMessage.
  // Use stable nav-<item id> and message-<item id> identifiers.
}
~~~

The navigation label is whitespace-collapsed and truncated to 96 characters.

- [ ] **Step 5: Verify and commit**

Run: npm test -- tests/transcript.test.mjs

Expected: 2 tests PASS.

~~~bash
git add package.json tests/transcript.test.mjs skill/conversation-navigator
git commit -m "feat: project Codex threads for navigation"
~~~

---

### Task 2: App Server JSON-RPC Client

**Files:**
- Create: skill/conversation-navigator/scripts/app-server-client.mjs
- Test: tests/app-server-client.test.mjs

**Interfaces:**
- Produces AppServerClient.start(), request(), listThreads(), readThread(), and stop().
- listThreads(cwd) returns Thread[]; readThread(threadId) returns one Thread.

- [ ] **Step 1: Write a fake-process lifecycle test**

Use PassThrough for stdout, a Writable stdin that parses JSON lines, and an EventEmitter child. Assert:

~~~js
const client = new AppServerClient({ spawnProcess: () => fake.child });
await client.start();
assert.deepEqual(await client.listThreads("/repo"), [{ id: "thread-1" }]);
assert.deepEqual(await client.readThread("thread-1"), { id: "thread-1", turns: [] });
assert.deepEqual(fake.requests.map((request) => request.method), [
  "initialize", "thread/list", "thread/read"
]);
assert.deepEqual(fake.requests[1].params, {
  cwd: "/repo",
  sourceKinds: ["vscode"],
  sortKey: "updated_at",
  sortDirection: "desc"
});
client.stop();
~~~

Add a test that returns a JSON-RPC error and asserts rejection with its message.
Add tests that a malformed response line and an unexpected child-process exit reject all pending requests. Add a spawn-error test whose message identifies a missing codex executable.

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/app-server-client.test.mjs

Expected: FAIL because AppServerClient does not exist.

- [ ] **Step 3: Implement the client**

Use this interface:

~~~js
export class AppServerClient {
  constructor({ spawnProcess = spawn, command = "codex" } = {}) {}
  async start() {}
  request(method, params = undefined) {}
  notify(method, params = undefined) {}
  async listThreads(cwd) {}
  async readThread(threadId) {}
  stop() {}
}
~~~

start() must spawn codex app-server, attach a readline JSONL reader, send initialize with client name conversation_navigator and capabilities.experimentalApi true, then notify initialized. Correlate responses by numeric id. Reject pending requests on protocol errors or process exit. Ignore notifications without id.

- [ ] **Step 4: Verify and commit**

Run the focused test, then npm test. Expected: all tests PASS.

~~~bash
git add tests/app-server-client.test.mjs skill/conversation-navigator/scripts/app-server-client.mjs
git commit -m "feat: read threads through Codex app server"
~~~

---

### Task 3: Token-Protected Loopback HTTP Service

**Files:**
- Create: skill/conversation-navigator/scripts/server.mjs
- Test: tests/server.test.mjs

**Interfaces:**
- Consumes a client with listThreads(cwd), readThread(threadId), and stop().
- Produces createNavigatorServer(options) resolving to { url, token, close }.
- GET /api/threads returns thread metadata.
- GET /api/threads/:id returns a ProjectedThread.

- [ ] **Step 1: Write failing API tests**

Start with token test-token, idleMs 0, and openUrl false. Assert:

~~~js
const unauthorized = await fetch(url + "api/threads");
assert.equal(unauthorized.status, 401);

const authorized = await fetch(url + "api/threads", {
  headers: { authorization: "Bearer test-token" }
});
assert.equal(authorized.status, 200);
assert.deepEqual(await authorized.json(), {
  threads: [{ id: "thread-1", name: "Runtime", preview: "Explain run", updatedAt: 42 }]
});
~~~

Also test /api/threads/thread-1 projection, static index serving, 404 behavior, and client.stop() on close.
Use a short nonzero idleMs in a fake-timer-friendly test and assert an inactive service closes itself.

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/server.test.mjs

Expected: FAIL because server.mjs does not exist.

- [ ] **Step 3: Implement the service**

Use this signature:

~~~js
export async function createNavigatorServer({
  client,
  cwd,
  webRoot = fileURLToPath(new URL("../assets/web/", import.meta.url)),
  token = randomBytes(24).toString("hex"),
  idleMs = 30 * 60_000,
  openUrl = true
}) {}
~~~

Rules:

- Serve only fixed /, /app.js, and /style.css assets.
- Require Authorization: Bearer <token> for every /api/ path.
- Map thread list responses to id, name, preview, and updatedAt.
- Decode the thread id and call projectThread for thread reads.
- Return JSON errors with status 500 and unknown paths with 404.
- Construct http://127.0.0.1:<port>/#token=<token>.
- Update last activity on every request and close after idleMs when idleMs > 0.
- close() clears timers, closes HTTP, stops App Server, and is idempotent.

The CLI parses --cwd and --no-open, starts AppServerClient, prints Conversation Navigator: <URL>, installs signal cleanup, and best-effort opens via xdg-open, open, or cmd.exe.

- [ ] **Step 4: Verify and commit**

Run focused tests, then npm test. Expected: all tests PASS.

~~~bash
git add tests/server.test.mjs skill/conversation-navigator/scripts/server.mjs
git commit -m "feat: serve a private local conversation API"
~~~

---

### Task 4: Two-Pane Browser Navigator

**Files:**
- Create: skill/conversation-navigator/assets/web/index.html
- Create: skill/conversation-navigator/assets/web/app.js
- Create: skill/conversation-navigator/assets/web/style.css
- Test: tests/web-assets.test.mjs

**Interfaces:**
- Consumes Task 3 API and token from location.hash.
- Produces outline buttons targeting message-<messageId> elements.

- [ ] **Step 1: Write failing UI-contract tests**

Assert the HTML contains thread-select, message-search, message-outline, transcript, and /app.js. Assert app.js contains scrollIntoView, IntersectionObserver, and setInterval but no assignment to innerHTML. Assert CSS contains grid-template-columns.

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/web-assets.test.mjs

Expected: FAIL because assets do not exist.

- [ ] **Step 3: Create the semantic shell**

Use:

~~~html
<header>
  <div><strong>Conversation Navigator</strong><span id="status"></span></div>
  <select id="thread-select" aria-label="Conversation"></select>
</header>
<main>
  <aside>
    <input id="message-search" type="search" placeholder="Search user messages">
    <nav id="message-outline" aria-label="User messages"></nav>
  </aside>
  <section id="transcript" aria-label="Conversation transcript"></section>
</main>
<script type="module" src="/app.js"></script>
~~~

- [ ] **Step 4: Implement safe browser behavior**

Implement:

~~~js
function api(path) {}
function renderThreadOptions(threads) {}
function renderOutline(navigation) {}
function renderTranscript(thread) {}
function observeVisibleMessages() {}
async function loadThreads() {}
async function loadSelectedThread() {}
~~~

Use createElement and textContent only. Clicking an outline entry calls scrollIntoView({ behavior: "smooth", block: "start" }). Search filters outline buttons. IntersectionObserver highlights the visible message. Poll every 2,000 ms. Skip identical payloads. Preserve scrollTop unless the user was within 32 pixels of the bottom.

When no matching thread exists, render an empty state containing the requested project context. When a refresh fails after a successful render, keep the last transcript and show the error in the status banner instead of clearing the page.

- [ ] **Step 5: Add responsive styling**

Use a desktop two-column grid and switch to stacked rows below 720px. Give both panes independent scrolling, readable pre-wrapped message cards, and visible selected/active/focus states.

- [ ] **Step 6: Verify and commit**

Run: npm test

Expected: all tests PASS.

~~~bash
git add tests/web-assets.test.mjs skill/conversation-navigator/assets/web
git commit -m "feat: add the conversation navigator interface"
~~~

---

### Task 5: Skill Workflow, Installation, and Live Smoke Test

**Files:**
- Modify: skill/conversation-navigator/SKILL.md
- Regenerate: skill/conversation-navigator/agents/openai.yaml
- Create symlink: /home/user/.codex/skills/conversation-navigator

**Interfaces:**
- Produces a discoverable $conversation-navigator personal skill.

- [ ] **Step 1: Write final Skill instructions**

Use only name and description in frontmatter. The description must cover requests to open a conversation navigator, browse Codex history by user message, show a clickable message outline, and locate an earlier Codex prompt.

The body must instruct Codex to resolve the loaded skill directory, run:

~~~bash
node <skill-dir>/scripts/server.mjs --cwd <current-working-directory>
~~~

in a background terminal, report the printed URL, keep it running while used, stop it when asked, and disclose that it cannot scroll the official panel.

- [ ] **Step 2: Regenerate metadata**

Run generate_openai_yaml.py with:

- display_name: Conversation Navigator
- short_description: Browse local Codex conversations by user message
- default_prompt: Use $conversation-navigator to open a read-only navigator for this project.

Expected: quoted strings and an explicit $conversation-navigator mention.

- [ ] **Step 3: Validate skill and tests**

Run quick_validate.py on skill/conversation-navigator and npm test.

Expected: validation success and all tests PASS.

- [ ] **Step 4: Install**

Create a symlink from the project skill directory to /home/user/.codex/skills/conversation-navigator. Verify readlink resolves to the project.

- [ ] **Step 5: Verify discovery**

Initialize codex app-server, call skills/list, and assert a returned skill is named conversation-navigator with the installed path.

- [ ] **Step 6: Live smoke test**

Run:

~~~bash
node skill/conversation-navigator/scripts/server.mjs --cwd /home/user/claw-code --no-open
~~~

Use the printed tokenized URL to verify:

- /api/threads returns the current VS Code thread.
- The newest thread payload contains this conversation's user messages.
- HTML, JavaScript, and CSS return 200.
- The service stops cleanly.
- A before/after checksum of the selected rollout file is unchanged.

- [ ] **Step 7: Final verification and commit**

Run git diff --check, npm test, quick_validate.py, and git status --short.

Expected: no whitespace errors, tests and validation pass, and only intentional files remain.

~~~bash
git add skill/conversation-navigator/SKILL.md skill/conversation-navigator/agents/openai.yaml
git commit -m "feat: install the conversation navigator skill"
~~~
