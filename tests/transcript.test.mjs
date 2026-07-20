import assert from "node:assert/strict";
import test from "node:test";

import {
  inputToText,
  projectThread,
} from "../skill/conversation-navigator/scripts/transcript.mjs";

test("inputToText renders supported user input as plain text", () => {
  assert.equal(inputToText({ type: "text", text: "<b>hello</b>" }), "<b>hello</b>");
  assert.equal(inputToText({ type: "skill", name: "review" }), "$review");
  assert.equal(inputToText({ type: "mention", name: "src/main.rs" }), "@src/main.rs");
  assert.equal(
    inputToText({ type: "localImage", path: "/tmp/a.png" }),
    "[Local image: /tmp/a.png]",
  );
  assert.equal(
    inputToText({ type: "image", url: "data:image/png;base64,x" }),
    "[Image]",
  );
});

test("projectThread creates one outline entry per user message", () => {
  const result = projectThread({
    id: "thread-1",
    name: "Runtime",
    preview: "Explain run",
    updatedAt: 42,
    turns: [
      {
        id: "turn-1",
        items: [
          {
            type: "userMessage",
            id: "user-1",
            content: [{ type: "text", text: "Explain run()" }],
          },
          { type: "reasoning", id: "reasoning-1", summary: [], content: [] },
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
        ],
      },
    ],
  });

  assert.deepEqual(result.navigation, [
    {
      id: "nav-user-1",
      turnId: "turn-1",
      messageId: "user-1",
      text: "Explain run()",
      label: "Explain run()",
    },
  ]);
  assert.deepEqual(
    result.turns[0].messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "Explain run()" },
      { role: "assistant", text: "run dispatches actions." },
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /I am checking the runtime/);
});

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

test("projectThread compacts and truncates long navigation labels", () => {
  const result = projectThread({
    id: "thread-1",
    turns: [
      {
        id: "turn-1",
        items: [
          {
            type: "userMessage",
            id: "user-1",
            content: [{ type: "text", text: `first\n\n${"x".repeat(120)}` }],
          },
        ],
      },
    ],
  });

  assert.equal(result.navigation[0].label.length, 96);
  assert.match(result.navigation[0].label, /^first x+…$/);
});
