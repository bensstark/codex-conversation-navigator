# Final-Answer Transcript and Instant Jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only completed `final_answer` Codex messages and make outline navigation jump immediately without animation.

**Architecture:** Enforce the message visibility boundary in `projectThread`, before data reaches the HTTP API. Keep browser navigation in a small exported helper so its scroll behavior is directly unit-testable, and remove the CSS rule that could re-enable animation.

**Tech Stack:** Node.js 20+ ES modules, Node built-in test runner, vanilla browser JavaScript and CSS, Codex App Server.

## Global Constraints

- Continue showing every user message and using it as the navigation anchor.
- Show an `agentMessage` only when its App Server `phase` is exactly `final_answer`.
- Never send `commentary` messages to the browser.
- Until a `final_answer` arrives, an incomplete turn shows only its user message.
- Keep reasoning, command, tool, and other non-message items hidden.
- Clicking an outline item must move immediately with start alignment and preserve active-item highlighting.
- Preserve search, polling, scroll-position preservation during refresh, authentication, loopback-only binding, and read-only behavior.
- Add no runtime dependency.

---

### Task 1: Filter Transcript Projection to Final Answers

**Files:**
- Modify: `tests/transcript.test.mjs`
- Modify: `skill/conversation-navigator/scripts/transcript.mjs`

**Interfaces:**
- Consumes: App Server `Thread` values whose turn items may include `{ type: "agentMessage", phase: "commentary" | "final_answer", text: string }`.
- Produces: `projectThread(thread)` with every visible user message and only assistant messages whose source phase is `final_answer`.

- [ ] **Step 1: Strengthen the completed-turn projection test**

Replace the agent-message portion of the existing `projectThread creates one outline entry per user message` fixture with both phases:

```js
{
  type: "agentMessage",
  id: "agent-commentary-1",
  phase: "commentary",
  text: "I am checking the runtime.",
},
{
  type: "agentMessage",
  id: "agent-final-1",
  phase: "final_answer",
  text: "run dispatches actions.",
},
```

Keep the expected visible messages exactly:

```js
[
  { role: "user", text: "Explain run()" },
  { role: "assistant", text: "run dispatches actions." },
]
```

Add an explicit transport-boundary assertion:

```js
assert.doesNotMatch(JSON.stringify(result), /I am checking the runtime/);
```

- [ ] **Step 2: Add a failing test for an unfinished turn**

Append this test:

```js
test("projectThread hides commentary while preserving an unfinished user turn", () => {
  const result = projectThread({
    id: "thread-1",
    turns: [
      {
        id: "turn-running",
        items: [
          {
            type: "userMessage",
            id: "user-running",
            content: [{ type: "text", text: "Check the failing test" }],
          },
          {
            type: "agentMessage",
            id: "agent-running",
            phase: "commentary",
            text: "I am still investigating.",
          },
        ],
      },
    ],
  });

  assert.deepEqual(result.turns[0].messages, [
    { id: "user-running", role: "user", text: "Check the failing test" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /still investigating/);
});
```

- [ ] **Step 3: Run the focused tests and verify the expected failure**

Run:

```bash
npm test -- tests/transcript.test.mjs
```

Expected: FAIL because `projectThread` still includes both commentary messages.

- [ ] **Step 4: Add the strict phase filter**

Change the assistant branch in `projectThread` to:

```js
} else if (
  item.type === "agentMessage"
  && item.phase === "final_answer"
  && item.text
) {
  messages.push({ id: item.id, role: "assistant", text: item.text });
}
```

- [ ] **Step 5: Run focused and complete tests**

Run:

```bash
npm test -- tests/transcript.test.mjs
npm test
```

Expected: both commands PASS with zero failures.

- [ ] **Step 6: Commit the projection change**

```bash
git add tests/transcript.test.mjs skill/conversation-navigator/scripts/transcript.mjs
git commit -m "fix: show only final Codex answers"
```

---

### Task 2: Make Outline Navigation Immediate

**Files:**
- Modify: `tests/web-assets.test.mjs`
- Modify: `skill/conversation-navigator/assets/web/app.js`
- Modify: `skill/conversation-navigator/assets/web/style.css`

**Interfaces:**
- Consumes: a target DOM element that implements `scrollIntoView(options)`.
- Produces: `jumpToMessage(target)` requesting `{ behavior: "auto", block: "start" }` and safely doing nothing for a missing target.

- [ ] **Step 1: Add failing frontend behavior assertions**

Extend the static asset test with:

```js
assert.doesNotMatch(app, /behavior:\s*"smooth"/);
assert.doesNotMatch(css, /scroll-behavior:\s*smooth/);
```

Change the helper import to include `jumpToMessage`:

```js
const { filterNavigation, isNearBottom, jumpToMessage } = await import(
  "../skill/conversation-navigator/assets/web/app.js"
);
```

Then append to the helper test:

```js
let scrollOptions;
jumpToMessage({
  scrollIntoView(options) {
    scrollOptions = options;
  },
});
assert.deepEqual(scrollOptions, { behavior: "auto", block: "start" });
assert.doesNotThrow(() => jumpToMessage(null));
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
npm test -- tests/web-assets.test.mjs
```

Expected: FAIL because `jumpToMessage` is not exported and both smooth-scrolling rules still exist.

- [ ] **Step 3: Implement the immediate-jump helper**

Add this exported helper after `isNearBottom` in `app.js`:

```js
export function jumpToMessage(target) {
  target?.scrollIntoView({ behavior: "auto", block: "start" });
}
```

Replace the click handler's direct scrolling call with:

```js
jumpToMessage(document.getElementById(`message-${entry.messageId}`));
setActiveMessage(entry.messageId);
```

- [ ] **Step 4: Remove container-level smooth scrolling**

Delete this declaration from `.transcript` in `style.css`:

```css
scroll-behavior: smooth;
```

- [ ] **Step 5: Run focused and complete tests**

Run:

```bash
npm test -- tests/web-assets.test.mjs
npm test
```

Expected: both commands PASS with zero failures.

- [ ] **Step 6: Commit the browser behavior change**

```bash
git add tests/web-assets.test.mjs skill/conversation-navigator/assets/web/app.js skill/conversation-navigator/assets/web/style.css
git commit -m "fix: jump instantly between user messages"
```

---

### Task 3: Verify the Installed Skill End to End

**Files:**
- Verify: `skill/conversation-navigator/`
- Verify: `/home/user/.codex/skills/conversation-navigator`

**Interfaces:**
- Consumes: the installed symlink, local `codex app-server`, and a current VS Code thread containing both `commentary` and `final_answer` phases.
- Produces: fresh evidence that the installed HTTP API exposes only final assistant messages and retains all existing safety behavior.

- [ ] **Step 1: Validate tests, package, diff, and installation target**

Run:

```bash
npm test
python3 /home/user/.codex/skills/.system/skill-creator/scripts/quick_validate.py skill/conversation-navigator
git diff --check
test "$(readlink -f /home/user/.codex/skills/conversation-navigator)" = "/home/user/codex-conversation-navigator/skill/conversation-navigator"
```

Expected: 18 tests PASS, `Skill is valid!`, no diff errors, and exit code 0.

- [ ] **Step 2: Run a live projection smoke test through the HTTP API**

Run this from the repository root:

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { AppServerClient } from "./skill/conversation-navigator/scripts/app-server-client.mjs";
import { createNavigatorServer } from "./skill/conversation-navigator/scripts/server.mjs";

const cwd = "/home/user/claw-code";
const client = new AppServerClient();
let navigator;
try {
  await client.start();
  const rawThreads = await client.listThreads(cwd);
  assert.ok(rawThreads.length > 0);
  const raw = await client.readThread(rawThreads[0].id);
  const rawAgentItems = raw.turns.flatMap((turn) => turn.items)
    .filter((item) => item.type === "agentMessage" && item.text);
  assert.ok(rawAgentItems.some((item) => item.phase === "commentary"));
  assert.ok(rawAgentItems.some((item) => item.phase === "final_answer"));

  navigator = await createNavigatorServer({ client, cwd, openUrl: false, idleMs: 0 });
  const base = new URL(navigator.url);
  base.hash = "";
  const headers = { authorization: `Bearer ${navigator.token}` };
  const response = await fetch(
    new URL(`api/threads/${encodeURIComponent(raw.id)}`, base),
    { headers },
  );
  assert.equal(response.status, 200);
  const { thread } = await response.json();
  const visibleAssistantIds = thread.turns.flatMap((turn) => turn.messages)
    .filter((message) => message.role === "assistant")
    .map((message) => message.id);
  const expectedFinalIds = rawAgentItems
    .filter((item) => item.phase === "final_answer")
    .map((item) => item.id);
  assert.deepEqual(visibleAssistantIds, expectedFinalIds);
  console.log(JSON.stringify({
    rawCommentaryMessages: rawAgentItems.filter((item) => item.phase === "commentary").length,
    visibleAssistantMessages: visibleAssistantIds.length,
    finalAnswersOnly: true,
  }, null, 2));
} finally {
  if (navigator) await navigator.close();
  else client.stop();
}
' 
```

Expected: exit code 0 and JSON containing `"finalAnswersOnly": true`.

- [ ] **Step 3: Confirm repository state**

Run:

```bash
git status --short
git log --oneline --max-count=5
```

Expected: clean working tree and both behavior commits above the design commits.
