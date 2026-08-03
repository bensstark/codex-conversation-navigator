import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const skillRoot = new URL("../skill/conversation-navigator/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);

test("skill package documents the launch workflow without placeholders", async () => {
  const skill = await readFile(new URL("SKILL.md", skillRoot), "utf8");

  assert.match(skill, /^---\nname: conversation-navigator\n/m);
  assert.match(skill, /description: Use when /);
  assert.match(skill, /scripts\/server\.mjs/);
  assert.match(skill, /--cwd/);
  assert.doesNotMatch(skill, /--no-auth/);
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
    access(new URL("assets/web/file-viewer.html", skillRoot)),
    access(new URL("assets/web/file-viewer.js", skillRoot)),
    access(new URL("assets/web/file-viewer.css", skillRoot)),
    access(new URL("assets/web/vendor/marked.esm.js", skillRoot)),
    access(new URL("assets/web/vendor/MARKED-LICENSE", skillRoot)),
    access(new URL("assets/web/vendor/purify.es.mjs", skillRoot)),
    access(new URL("assets/web/vendor/DOMPURIFY-LICENSE", skillRoot)),
    access(new URL("assets/web/vendor/highlight.min.js", skillRoot)),
    access(new URL("assets/web/vendor/HIGHLIGHTJS-LICENSE", skillRoot)),
    access(new URL("agents/openai.yaml", skillRoot)),
  ]);
});

test("vendored markdown dependencies have pinned versions and licenses", async () => {
  const [marked, purify, highlight, packageJson, packageLock] = await Promise.all([
    readFile(new URL("assets/web/vendor/marked.esm.js", skillRoot), "utf8"),
    readFile(new URL("assets/web/vendor/purify.es.mjs", skillRoot), "utf8"),
    readFile(new URL("assets/web/vendor/highlight.min.js", skillRoot), "utf8"),
    readFile(new URL("package.json", packageRoot), "utf8"),
    readFile(new URL("package-lock.json", packageRoot), "utf8"),
  ]);

  assert.match(marked, /marked v18\.0\.6/i);
  const packageMetadata = JSON.parse(packageJson);
  const lockMetadata = JSON.parse(packageLock);
  assert.match(purify, /DOMPurify 3\.4\.12/i);
  assert.match(highlight, /Highlight\.js v11\.11\.1/i);
  assert.equal(packageMetadata.devDependencies.dompurify, "3.4.12");
  assert.equal(packageMetadata.devDependencies["@highlightjs/cdn-assets"], "11.11.1");
  assert.equal(lockMetadata.packages[""].devDependencies.dompurify, "3.4.12");
  assert.equal(
    lockMetadata.packages[""].devDependencies["@highlightjs/cdn-assets"],
    "11.11.1",
  );
  assert.equal(lockMetadata.packages["node_modules/dompurify"].version, "3.4.12");
  assert.equal(
    lockMetadata.packages["node_modules/@highlightjs/cdn-assets"].version,
    "11.11.1",
  );
  assert.equal(
    lockMetadata.packages[""].engines.node,
    packageMetadata.engines.node,
  );
});
