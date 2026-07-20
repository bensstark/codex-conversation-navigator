import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const skillRoot = new URL("../skill/conversation-navigator/", import.meta.url);

test("skill package documents the launch workflow without placeholders", async () => {
  const skill = await readFile(new URL("SKILL.md", skillRoot), "utf8");

  assert.match(skill, /^---\nname: conversation-navigator\n/m);
  assert.match(skill, /description: Use when /);
  assert.match(skill, /scripts\/server\.mjs/);
  assert.match(skill, /--cwd/);
  assert.match(skill, /read-only/i);
  assert.doesNotMatch(skill, /TODO/);
});

test("skill package includes its declared entrypoint and web assets", async () => {
  await Promise.all([
    access(new URL("scripts/server.mjs", skillRoot)),
    access(new URL("assets/web/index.html", skillRoot)),
    access(new URL("assets/web/app.js", skillRoot)),
    access(new URL("assets/web/style.css", skillRoot)),
    access(new URL("agents/openai.yaml", skillRoot)),
  ]);
});
