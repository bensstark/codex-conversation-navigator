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
    access(new URL("assets/web/markdown.js", skillRoot)),
    access(new URL("assets/web/vendor/marked.esm.js", skillRoot)),
    access(new URL("assets/web/vendor/MARKED-LICENSE", skillRoot)),
    access(new URL("assets/web/vendor/purify.es.mjs", skillRoot)),
    access(new URL("assets/web/vendor/DOMPURIFY-LICENSE", skillRoot)),
    access(new URL("agents/openai.yaml", skillRoot)),
  ]);
});

test("vendored markdown dependencies have pinned versions and licenses", async () => {
  const [marked, purify] = await Promise.all([
    readFile(new URL("assets/web/vendor/marked.esm.js", skillRoot), "utf8"),
    readFile(new URL("assets/web/vendor/purify.es.mjs", skillRoot), "utf8"),
  ]);

  assert.match(marked, /marked v18\.0\.6/i);
  assert.match(purify, /DOMPurify 3\.4\.7/i);
});
