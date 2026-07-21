# Sanitized Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render user messages and visible Codex final answers as full GitHub-Flavored Markdown while sanitizing raw HTML, hardening links and images, and preserving readable plain text on any renderer failure.

**Architecture:** Keep transcript projection and the local API unchanged. Add one browser-only `markdown.js` boundary that runs the pinned local Marked bundle, sanitizes the result with a pinned local DOMPurify bundle, post-processes the returned `DocumentFragment`, and hands only that fragment to `app.js`. Serve the three browser modules through the existing explicit static allowlist and reinforce the sanitizer with a restrictive Content Security Policy.

**Tech Stack:** Node.js 20.19+ ES modules, Node built-in test runner, jsdom 29.1.1 for development tests, Marked 18.0.6, DOMPurify 3.4.12, vanilla browser JavaScript and CSS.

## Global Constraints

- Render Markdown for both user messages and already-filtered assistant `final_answer` messages.
- Do not change transcript projection, polling, search, instant outline navigation, authentication, loopback-only binding, or read-only behavior.
- Do not render Codex commentary, reasoning, commands, tool calls, or other hidden items.
- Do not send transcript content to a CDN or any other rendering service.
- Do not add production npm dependencies. Browser execution must use the checked-in ESM bundles.
- Never assign untrusted or merely parsed content to `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` in application code.
- Allow safe raw HTML only after DOMPurify sanitization.
- Allow remote `http:` and `https:` images and raster `data:image/` sources; keep the documented privacy tradeoff that remote hosts receive normal request metadata.
- Open surviving links in a new tab with no opener and no referrer.
- Keep only disabled task-list checkboxes; remove all other interactive controls.
- Fall back per message to a plain text `DocumentFragment` if parsing, sanitization, or DOMPurify support fails.
- Preserve the installed skill symlink. If implementation happens in a worktree, smoke-test that worktree directly and restart the installed `main` server only after integration.

---

### Task 1: Pin and Serve the Local Markdown Dependencies

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `skill/conversation-navigator/assets/web/vendor/marked.esm.js`
- Create: `skill/conversation-navigator/assets/web/vendor/MARKED-LICENSE`
- Create: `skill/conversation-navigator/assets/web/vendor/purify.es.mjs`
- Create: `skill/conversation-navigator/assets/web/vendor/DOMPURIFY-LICENSE`
- Modify: `skill/conversation-navigator/scripts/server.mjs`
- Modify: `tests/server.test.mjs`
- Modify: `tests/skill-package.test.mjs`

**Interfaces:**
- `GET /vendor/marked.esm.js` returns the pinned Marked ESM bundle as JavaScript.
- `GET /vendor/purify.es.mjs` returns the pinned DOMPurify ESM bundle as JavaScript.
- Other `/vendor/*` paths remain unavailable.
- Every static response carries a CSP that permits approved images but blocks media, frames, embedded objects, and form submissions.

- [ ] **Step 1: Add failing static-serving and CSP assertions**

In `tests/server.test.mjs`, add `mkdir` to the `node:fs/promises` import:

```js
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
```

Update `createWebRoot` to create the fake vendor directory and files:

```js
async function createWebRoot(t) {
  const directory = await mkdtemp(join(tmpdir(), "conversation-navigator-"));
  const vendorDirectory = join(directory, "vendor");
  await mkdir(vendorDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "index.html"), "<html>navigator</html>"),
    writeFile(join(directory, "app.js"), "console.log('navigator')"),
    writeFile(join(directory, "style.css"), "body{}"),
    writeFile(join(vendorDirectory, "marked.esm.js"), "export const marked = {};"),
    writeFile(join(vendorDirectory, "purify.es.mjs"), "export default () => ({});"),
  ]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
```

After the existing index assertions in `serves static assets and protects thread APIs`, add:

```js
const policy = index.headers.get("content-security-policy");
assert.equal(index.headers.get("referrer-policy"), "no-referrer");
assert.match(policy, /img-src 'self' data: http: https:/);
assert.match(policy, /media-src 'none'/);
assert.match(policy, /frame-src 'none'/);
assert.match(policy, /object-src 'none'/);
assert.match(policy, /form-action 'none'/);

const marked = await fetch(apiUrl(navigator.url, "/vendor/marked.esm.js"));
assert.equal(marked.status, 200);
assert.match(marked.headers.get("content-type"), /^text\/javascript/);
assert.equal(marked.headers.get("referrer-policy"), "no-referrer");

const purify = await fetch(apiUrl(navigator.url, "/vendor/purify.es.mjs"));
assert.equal(purify.status, 200);
assert.match(purify.headers.get("content-type"), /^text\/javascript/);
assert.equal(purify.headers.get("referrer-policy"), "no-referrer");

const unlistedVendorFile = await fetch(
  apiUrl(navigator.url, "/vendor/DOMPURIFY-LICENSE"),
);
assert.equal(unlistedVendorFile.status, 404);
```

- [ ] **Step 2: Add failing package-completeness assertions**

Extend the access list in `tests/skill-package.test.mjs` with:

```js
access(new URL("assets/web/vendor/marked.esm.js", skillRoot)),
access(new URL("assets/web/vendor/MARKED-LICENSE", skillRoot)),
access(new URL("assets/web/vendor/purify.es.mjs", skillRoot)),
access(new URL("assets/web/vendor/DOMPURIFY-LICENSE", skillRoot)),
```

Add a version-pinning test:

```js
test("vendored markdown dependencies have pinned versions and licenses", async () => {
  const [marked, purify] = await Promise.all([
    readFile(new URL("assets/web/vendor/marked.esm.js", skillRoot), "utf8"),
    readFile(new URL("assets/web/vendor/purify.es.mjs", skillRoot), "utf8"),
  ]);

  assert.match(marked, /marked v18\.0\.6/i);
  assert.match(purify, /DOMPurify 3\.4\.12/i);
});
```

- [ ] **Step 3: Run the focused tests and verify the expected failures**

Run:

```bash
npm test -- tests/server.test.mjs tests/skill-package.test.mjs
```

Expected: FAIL because the vendor files do not exist, the server returns 404 for the new module URLs, and the CSP lacks the new directives.

- [ ] **Step 4: Install exact development versions and copy the browser distributions**

Run:

```bash
npm install --save-dev --save-exact jsdom@29.1.1 marked@18.0.6 dompurify@3.4.12
mkdir -p skill/conversation-navigator/assets/web/vendor
cp node_modules/marked/lib/marked.esm.js skill/conversation-navigator/assets/web/vendor/marked.esm.js
cp node_modules/marked/LICENSE skill/conversation-navigator/assets/web/vendor/MARKED-LICENSE
cp node_modules/dompurify/dist/purify.es.mjs skill/conversation-navigator/assets/web/vendor/purify.es.mjs
cp node_modules/dompurify/LICENSE skill/conversation-navigator/assets/web/vendor/DOMPURIFY-LICENSE
```

Add this line to `.gitignore`:

```gitignore
node_modules/
```

Change the Node engine in `package.json` to match jsdom's supported test environment:

```json
"engines": {
  "node": ">=20.19.0"
}
```

Confirm `package.json` contains all three exact versions under `devDependencies` and that `dependencies` is absent. Do not commit installed packages.

- [ ] **Step 5: Add the explicit static routes and defense-in-depth CSP**

Add these entries to `STATIC_FILES` in `server.mjs`:

```js
["/vendor/marked.esm.js", ["vendor/marked.esm.js", "text/javascript; charset=utf-8"]],
["/vendor/purify.es.mjs", ["vendor/purify.es.mjs", "text/javascript; charset=utf-8"]],
```

Replace the current image directive and add the four active-content directives:

```js
"img-src 'self' data: http: https:",
"media-src 'none'",
"frame-src 'none'",
"object-src 'none'",
"form-action 'none'",
```

Keep all existing CSP directives unchanged.

Add `"referrer-policy": "no-referrer"` to the header map for every successful static response, and assert that header on each exposed static route.

- [ ] **Step 6: Run focused and complete tests**

Run:

```bash
npm test -- tests/server.test.mjs tests/skill-package.test.mjs
npm test
```

Expected: both commands PASS with zero failures; the full suite now has 19 tests.

- [ ] **Step 7: Commit the pinned dependencies and server policy**

```bash
git add .gitignore package.json package-lock.json tests/server.test.mjs tests/skill-package.test.mjs skill/conversation-navigator/scripts/server.mjs skill/conversation-navigator/assets/web/vendor
git commit -m "feat: bundle markdown rendering dependencies"
```

---

### Task 2: Build and Test the Sanitized Markdown Boundary

**Files:**
- Create: `skill/conversation-navigator/assets/web/markdown.js`
- Create: `tests/markdown-renderer.test.mjs`
- Modify: `skill/conversation-navigator/scripts/server.mjs`
- Modify: `tests/server.test.mjs`
- Modify: `tests/skill-package.test.mjs`

**Interfaces:**
- `renderMarkdown(document, source, overrides?) -> DocumentFragment`
- Optional test overrides: `{ parse, createPurifier }`.
- The default path imports only `./vendor/marked.esm.js` and `./vendor/purify.es.mjs`.
- The returned fragment is either sanitized Markdown DOM or one plain text node containing the original source.

- [ ] **Step 1: Add a failing GFM and safe-HTML renderer test**

Create `tests/markdown-renderer.test.mjs` with this setup:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { renderMarkdown } from "../skill/conversation-navigator/assets/web/markdown.js";

function render(source, overrides) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "http://127.0.0.1/conversation/",
  });
  const container = dom.window.document.createElement("div");
  container.append(renderMarkdown(dom.window.document, source, overrides));
  return { container, window: dom.window };
}
```

Add the first test:

```js
test("renderMarkdown renders GFM and safe raw HTML", () => {
  const { container } = render(`# Heading

**bold** and ~~gone~~

- item
- [x] done

\`inline\`

\`\`\`js
const answer = 42;
\`\`\`

| name | value |
| --- | --- |
| answer | 42 |

> quoted

<details open><summary>More</summary><p>Safe HTML</p></details>`);

  assert.equal(container.querySelector("h1")?.textContent, "Heading");
  assert.equal(container.querySelector("strong")?.textContent, "bold");
  assert.equal(container.querySelector("del")?.textContent, "gone");
  assert.ok(container.querySelector("ul"));
  assert.equal(container.querySelector("pre code")?.textContent.trim(), "const answer = 42;");
  assert.ok(container.querySelector("table"));
  assert.ok(container.querySelector("blockquote"));
  assert.equal(container.querySelector("details summary")?.textContent, "More");
});
```

- [ ] **Step 2: Add an XSS regression test**

Append:

```js
test("renderMarkdown removes active content and unsafe attributes", () => {
  const { container } = render(`<script>alert(1)</script>
<style>body { display: none }</style>
<p id="shell" name="shell" class="takeover" style="position:fixed" onclick="alert(1)">safe text</p>
<a href="javascript:alert(1)">bad link</a>
<img src="javascript:alert(1)" srcset="https://bad.test/2x 2x" onerror="alert(1)">
<form><input type="text"><button formaction="https://bad.test">send</button></form>
<iframe src="https://bad.test"></iframe>
<object data="https://bad.test"></object>
<embed src="https://bad.test">
<video src="https://bad.test"><source src="https://bad.test"></video>
<audio src="https://bad.test"></audio>
<svg><script>alert(1)</script></svg>
<math><mi>x</mi></math>
<custom-element>custom text</custom-element>`);

  assert.equal(
    container.querySelector(
      "script, style, form, button, iframe, object, embed, video, audio, source, svg, math, custom-element",
    ),
    null,
  );
  assert.equal(container.querySelector("[id], [name], [class], [style], [srcset]"), null);
  assert.equal(container.querySelector("a")?.hasAttribute("href"), false);
  assert.equal(container.querySelector("img")?.hasAttribute("src"), false);
  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.equal(attribute.name.startsWith("on"), false);
    }
  }
});
```

- [ ] **Step 3: Add URL, image, and task-checkbox hardening tests**

Append:

```js
test("renderMarkdown hardens links, images, and task checkboxes", () => {
  const { container } = render(`[external](https://example.com/path)
[relative](/docs)
[mail](mailto:user@example.com)
[fragment](#part)
[bad](tel:+123)

![remote](https://images.example.com/picture.png)
![data](data:image/png;base64,AA==)
<img alt="svg" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
<img alt="ftp" src="ftp://example.com/picture.png">

- [x] done

<input type="checkbox" disabled checked>
<input type="text" disabled value="bad">`);

  const links = [...container.querySelectorAll("a")];
  assert.equal(links.length, 5);
  for (const link of links) {
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.getAttribute("referrerpolicy"), "no-referrer");
  }
  assert.equal(links.at(-1).hasAttribute("href"), false);

  const remote = container.querySelector('img[alt="remote"]');
  const data = container.querySelector('img[alt="data"]');
  for (const image of [remote, data]) {
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.equal(image.getAttribute("decoding"), "async");
    assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
  }
  assert.equal(container.querySelector('img[alt="svg"]').hasAttribute("src"), false);
  assert.equal(container.querySelector('img[alt="ftp"]').hasAttribute("src"), false);

  const inputs = [...container.querySelectorAll("input")];
  assert.equal(inputs.length, 1);
  assert.deepEqual(
    [...inputs[0].attributes].map(({ name }) => name).sort(),
    ["checked", "disabled", "type"],
  );
  assert.equal(inputs[0].getAttribute("type"), "checkbox");
});
```

Use the real default renderer for these regressions. Assert exact surviving `href` values for relative, `mailto:`, fragment, and protocol-relative HTTP(S) links, plus exact remote and raster-data image `src` values. Add raw `table`/`td`/`hr` width/height fixtures and image dimensions covering canonical `1` through `10000` values as well as zero, negative, decimal, unit/percentage, leading-zero, non-number, and over-limit values.

- [ ] **Step 4: Add parser, sanitizer, and unsupported-browser fallback tests**

Append:

```js
test("renderMarkdown falls back to plain text when rendering is unavailable", () => {
  const source = "# literal <img src=x onerror=alert(1)>";
  const throwingParser = render(source, {
    parse() {
      throw new Error("parse failed");
    },
  }).container;
  assert.equal(throwingParser.textContent, source);
  assert.equal(throwingParser.children.length, 0);

  const throwingSanitizer = render(source, {
    createPurifier() {
      return {
        isSupported: true,
        sanitize() {
          throw new Error("sanitize failed");
        },
      };
    },
  }).container;
  assert.equal(throwingSanitizer.textContent, source);
  assert.equal(throwingSanitizer.children.length, 0);

  const unsupported = render(source, {
    createPurifier() {
      return { isSupported: false };
    },
  }).container;
  assert.equal(unsupported.textContent, source);
  assert.equal(unsupported.children.length, 0);
});
```

- [ ] **Step 5: Add failing serving and package assertions for `markdown.js`**

In `createWebRoot` in `tests/server.test.mjs`, add:

```js
writeFile(join(directory, "markdown.js"), "export function renderMarkdown() {}"),
```

In the static-serving test, fetch and assert the new module before the vendor modules:

```js
const markdown = await fetch(apiUrl(navigator.url, "/markdown.js"));
assert.equal(markdown.status, 200);
assert.match(markdown.headers.get("content-type"), /^text\/javascript/);
```

Add this path to the package access list in `tests/skill-package.test.mjs`:

```js
access(new URL("assets/web/markdown.js", skillRoot)),
```

- [ ] **Step 6: Run the focused tests and verify the expected failures**

Run:

```bash
npm test -- tests/markdown-renderer.test.mjs tests/server.test.mjs tests/skill-package.test.mjs
```

Expected: FAIL because `markdown.js` does not exist and is not served.

- [ ] **Step 7: Implement the safe renderer**

Create `skill/conversation-navigator/assets/web/markdown.js`:

```js
import createDOMPurify from "./vendor/purify.es.mjs";
import { marked } from "./vendor/marked.esm.js";

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "em", "strong", "del",
  "a", "img", "blockquote", "ol", "ul", "li", "code", "pre", "hr", "table",
  "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
  "input", "div", "span", "b", "i", "u", "s", "ins", "abbr", "cite", "dfn",
  "kbd", "mark", "q", "samp", "small", "sub", "sup", "time", "var", "ruby",
  "rp", "rt", "bdi", "bdo", "wbr", "figure", "figcaption", "details", "summary",
];
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "open", "type", "disabled", "checked", "align",
  "colspan", "rowspan", "span", "start", "reversed", "value", "width", "height",
  "cite", "datetime", "dir", "lang", "scope",
];
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const SAFE_TABLE_ALIGNMENTS = new Set(["left", "center", "right"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp)(?:;[^,]*)?,/i;
const SAFE_IMAGE_DIMENSION = /^(?:[1-9]\d{0,3}|10000)$/;
const LEADING_ZERO_WIDTH = /^[\u200B\u200C\u200D\u200E\u200F\uFEFF]+/;

function textFragment(document, text) {
  const fragment = document.createDocumentFragment();
  fragment.append(document.createTextNode(text));
  return fragment;
}

function hasAllowedLink(document, value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    return true;
  }
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(trimmed, document.baseURI).protocol);
  } catch {
    return false;
  }
}

function hasAllowedImage(document, value) {
  const trimmed = value.trim();
  if (SAFE_DATA_IMAGE.test(trimmed)) {
    return true;
  }
  try {
    return SAFE_IMAGE_PROTOCOLS.has(new URL(trimmed, document.baseURI).protocol);
  } catch {
    return false;
  }
}

function hardenFragment(document, fragment) {
  for (const element of fragment.querySelectorAll("[width], [height]")) {
    if (!element.matches("img")) {
      element.removeAttribute("width");
      element.removeAttribute("height");
    }
  }

  for (const element of fragment.querySelectorAll("[align]")) {
    const isTableCell = element.matches("th, td");
    const alignment = element.getAttribute("align")?.toLowerCase();
    if (!isTableCell || !SAFE_TABLE_ALIGNMENTS.has(alignment)) {
      element.removeAttribute("align");
    }
  }

  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (href !== null && !hasAllowedLink(document, href)) {
      link.removeAttribute("href");
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("referrerpolicy", "no-referrer");
  }

  for (const image of fragment.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (src !== null && !hasAllowedImage(document, src)) {
      image.removeAttribute("src");
    }
    for (const attribute of ["width", "height"]) {
      const value = image.getAttribute(attribute);
      if (value !== null && !SAFE_IMAGE_DIMENSION.test(value)) {
        image.removeAttribute(attribute);
      }
    }
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    image.setAttribute("referrerpolicy", "no-referrer");
  }

  for (const input of [...fragment.querySelectorAll("input")]) {
    const keep = input.getAttribute("type")?.toLowerCase() === "checkbox"
      && input.hasAttribute("disabled")
      && input.closest("li") !== null;
    const checked = input.hasAttribute("checked");
    if (!keep) {
      input.remove();
      continue;
    }
    for (const attribute of [...input.attributes]) {
      input.removeAttribute(attribute.name);
    }
    input.setAttribute("type", "checkbox");
    input.setAttribute("disabled", "");
    if (checked) {
      input.setAttribute("checked", "");
    }
  }
}

export function renderMarkdown(document, source, {
  parse = (value) => marked.parse(value, { async: false, gfm: true }),
  createPurifier = createDOMPurify,
} = {}) {
  const text = String(source ?? "");
  try {
    const purifier = createPurifier(document.defaultView);
    if (!purifier?.isSupported) {
      return textFragment(document, text);
    }
    const html = parse(text.replace(LEADING_ZERO_WIDTH, ""));
    const fragment = purifier.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
      SANITIZE_NAMED_PROPS: true,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
    hardenFragment(document, fragment);
    return fragment;
  } catch {
    return textFragment(document, text);
  }
}
```

- [ ] **Step 8: Serve only the renderer module**

Add this entry to `STATIC_FILES` in `server.mjs`:

```js
["/markdown.js", ["markdown.js", "text/javascript; charset=utf-8"]],
```

Do not add a wildcard route or serve license files.

- [ ] **Step 9: Run focused and complete tests**

Run:

```bash
npm test -- tests/markdown-renderer.test.mjs tests/server.test.mjs tests/skill-package.test.mjs
npm test
```

Expected: both commands PASS with zero failures; the full suite now has 23 tests.

- [ ] **Step 10: Commit the renderer boundary**

```bash
git add tests/markdown-renderer.test.mjs tests/server.test.mjs tests/skill-package.test.mjs skill/conversation-navigator/assets/web/markdown.js skill/conversation-navigator/scripts/server.mjs
git commit -m "feat: add sanitized markdown renderer"
```

---

### Task 3: Render and Style Markdown in Transcript Cards

**Files:**
- Modify: `skill/conversation-navigator/assets/web/app.js`
- Modify: `skill/conversation-navigator/assets/web/style.css`
- Modify: `tests/web-assets.test.mjs`

**Interfaces:**
- `renderTranscript(thread)` builds each `.message-text` node, replaces its children with `renderMarkdown(document, message.text)`, and appends it to the message card.
- All Markdown presentation rules remain scoped below `.message-text`.

- [ ] **Step 1: Add failing integration assertions**

In `tests/web-assets.test.mjs`, add these assertions to `web assets expose the navigation interface safely`:

```js
assert.match(app, /import \{ renderMarkdown \} from "\.\/markdown\.js"/);
assert.match(app, /replaceChildren\(renderMarkdown\(document, message\.text\)\)/);
assert.doesNotMatch(app, /createElement\("div", "message-text", message\.text\)/);
assert.doesNotMatch(app, /\.innerHTML\s*=/);
assert.doesNotMatch(app, /\.outerHTML\s*=/);
assert.doesNotMatch(app, /insertAdjacentHTML|document\.write/);
assert.match(css, /\.message-text h2/);
assert.match(css, /\.message-text pre/);
assert.match(css, /\.message-text table/);
assert.match(css, /\.message-text img/);
assert.match(css, /\.message-text blockquote/);
assert.match(css, /\.message-text input\[type="checkbox"\]/);
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
npm test -- tests/web-assets.test.mjs
```

Expected: FAIL because `app.js` still assigns the message text through `textContent` and Markdown styles do not exist.

- [ ] **Step 3: Integrate `renderMarkdown` into `app.js`**

Add this import at the top of `app.js`:

```js
import { renderMarkdown } from "./markdown.js";
```

Replace the current `article.append(...)` block inside `renderTranscript` with:

```js
const body = createElement("div", "message-text");
body.replaceChildren(renderMarkdown(document, message.text));
article.append(
  createElement("p", "message-role", message.role === "user" ? "你" : "Codex"),
  body,
);
```

Do not change `createElement`; it remains the safe text builder for the rest of the application.

Export a direct-child selector and use it at the observer boundary so transcript content cannot forge observed user messages:

```js
export function selectUserMessageArticles(transcript) {
  return [...transcript.children].filter((child) =>
    child.matches('article.message[data-role="user"]'));
}

for (const message of selectUserMessageArticles(elements.transcript)) {
  state.observer.observe(message);
}
```

Cover this with a real jsdom DOM fixture that selects only the direct application message article and excludes nested, outside, wrong-tag, and missing-class forgeries.

- [ ] **Step 4: Replace the plain-text rule with scoped Markdown styles**

Replace the existing `.message-text` rule and add the following adjacent rules in `style.css`:

```css
.message-text {
  min-width: 0;
  overflow-wrap: anywhere;
  font: 0.95rem/1.68 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.message-text > :first-child {
  margin-top: 0;
}

.message-text > :last-child {
  margin-bottom: 0;
}

.message-text h1,
.message-text h2,
.message-text h3,
.message-text h4,
.message-text h5,
.message-text h6 {
  margin: 1.35em 0 0.55em;
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.25;
}

.message-text h1 { font-size: 1.5rem; }
.message-text h2 { font-size: 1.3rem; }
.message-text h3 { font-size: 1.12rem; }

.message-text p,
.message-text ul,
.message-text ol,
.message-text blockquote,
.message-text pre,
.message-text table,
.message-text details {
  margin: 0 0 1em;
}

.message-text ul,
.message-text ol {
  padding-left: 1.55em;
}

.message-text li + li {
  margin-top: 0.25em;
}

.message-text blockquote {
  padding: 0.15em 0 0.15em 1em;
  border-left: 3px solid var(--accent);
  color: var(--muted);
}

.message-text code,
.message-text pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.message-text :not(pre) > code {
  padding: 0.12em 0.34em;
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.14);
}

.message-text pre {
  overflow-x: auto;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(20, 20, 17, 0.9);
  color: #f4f0e7;
}

.message-text pre code {
  white-space: pre;
}

.message-text a {
  color: var(--accent);
  text-underline-offset: 0.16em;
}

.message-text img {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0.8em auto;
  object-fit: contain;
  border-radius: 8px;
}

.message-text table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.message-text th,
.message-text td {
  padding: 0.45em 0.65em;
  border: 1px solid var(--line);
  text-align: left;
}

.message-text th[align="left"],
.message-text td[align="left"] {
  text-align: left;
}

.message-text th[align="center"],
.message-text td[align="center"] {
  text-align: center;
}

.message-text th[align="right"],
.message-text td[align="right"] {
  text-align: right;
}

.message-text th {
  background: rgba(127, 127, 127, 0.1);
}

.message-text hr {
  margin: 1.4em 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.message-text details {
  padding: 0.7em 0.85em;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.message-text summary {
  cursor: pointer;
  font-weight: 650;
}

.message-text input[type="checkbox"] {
  width: auto;
  margin: 0 0.45em 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  accent-color: var(--accent);
}
```

- [ ] **Step 5: Run focused and complete tests**

Run:

```bash
npm test -- tests/web-assets.test.mjs tests/markdown-renderer.test.mjs
npm test
```

Expected: both commands PASS with zero failures; the full suite remains at 23 tests.

- [ ] **Step 6: Commit the browser integration**

```bash
git add tests/web-assets.test.mjs skill/conversation-navigator/assets/web/app.js skill/conversation-navigator/assets/web/style.css
git commit -m "feat: render conversation messages as markdown"
```

---

### Task 4: Validate Security, Packaging, and Live Behavior

**Files:**
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `skill/conversation-navigator/`

**Interfaces:**
- Consumes: a completed implementation branch and the local Codex App Server.
- Produces: fresh automated, package, HTTP, and real-thread evidence before integration or restart.

- [ ] **Step 1: Run the complete automated checks**

Run:

```bash
node --version
npm test
npm audit --registry=https://registry.npmjs.org
python3 /home/user/.codex/skills/.system/skill-creator/scripts/quick_validate.py skill/conversation-navigator
git diff --check
```

Expected:

- Node is 20.19 or newer.
- 26 tests PASS with zero failures.
- The full official-registry dependency audit includes development dependencies and reports zero vulnerabilities.
- Skill validation prints `Skill is valid!`.
- `git diff --check` exits with no output.

- [ ] **Step 2: Verify the static allowlist and security headers through a real server**

Run from the implementation repository or worktree:

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { AppServerClient } from "./skill/conversation-navigator/scripts/app-server-client.mjs";
import { createNavigatorServer } from "./skill/conversation-navigator/scripts/server.mjs";

const client = new AppServerClient();
let navigator;
try {
  await client.start();
  navigator = await createNavigatorServer({
    client,
    cwd: "/home/user/claw-code",
    openUrl: false,
    idleMs: 0,
  });
  const base = new URL(navigator.url);
  base.hash = "";
  for (const path of ["/", "/app.js", "/markdown.js", "/vendor/marked.esm.js", "/vendor/purify.es.mjs"]) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const policy = response.headers.get("content-security-policy");
    assert.match(policy, /img-src 'self' data: http: https:/);
    assert.match(policy, /media-src 'none'/);
    assert.match(policy, /frame-src 'none'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /form-action 'none'/);
  }
  assert.equal((await fetch(new URL("/vendor/DOMPURIFY-LICENSE", base))).status, 404);
  console.log("static markdown assets and CSP verified");
} finally {
  if (navigator) await navigator.close();
  else client.stop();
}
'
```

Expected: exit code 0 and `static markdown assets and CSP verified`.

- [ ] **Step 3: Exercise the real renderer against a representative safe and hostile fixture**

Run:

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderMarkdown } from "./skill/conversation-navigator/assets/web/markdown.js";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://127.0.0.1/" });
const output = dom.window.document.createElement("div");
output.append(renderMarkdown(dom.window.document, `# Markdown works

| safe | value |
| --- | --- |
| yes | **42** |

![remote](https://example.com/image.png)

<details open><summary>HTML</summary>kept</details>
<script>alert(1)</script>
<img src=x onerror=alert(1)>`));

assert.ok(output.querySelector("h1"));
assert.ok(output.querySelector("table"));
assert.ok(output.querySelector("strong"));
assert.ok(output.querySelector("details"));
assert.equal(output.querySelector("script"), null);
assert.equal(output.querySelector("[onerror]"), null);
console.log("sanitized markdown DOM verified");
'
```

Expected: exit code 0 and `sanitized markdown DOM verified`.

- [ ] **Step 4: Confirm the real current project still returns only final answers**

Reuse the live API projection smoke test from `docs/superpowers/plans/2026-07-21-final-answer-instant-jump.md`, Task 3 Step 2.

Expected: exit code 0, at least one real thread is read, and the JSON result contains `"finalAnswersOnly": true`.

- [ ] **Step 5: Review the final diff and repository state**

Run:

```bash
git status --short
git diff --stat da09919..HEAD
git log --oneline --max-count=8
```

Expected: no uncommitted files; all feature commits after `da09919` are visible. Review every changed file for a direct connection to Markdown rendering or its tests.

- [ ] **Step 6: Integrate, validate the installed path, and restart the navigator**

After the implementation branch has been reviewed and locally merged into `main`:

```bash
cd /home/user/codex-conversation-navigator
npm test
python3 /home/user/.codex/skills/.system/skill-creator/scripts/quick_validate.py skill/conversation-navigator
readlink -f /home/user/.codex/skills/conversation-navigator
```

Expected: 26 tests PASS, `Skill is valid!`, and the symlink resolves to `/home/user/codex-conversation-navigator/skill/conversation-navigator`.

Stop the previously running navigator with `Ctrl+C`, then launch the installed version without opening another window automatically:

```bash
node /home/user/.codex/skills/conversation-navigator/scripts/server.mjs --cwd /home/user/claw-code --no-open
```

Open the printed tokenized loopback URL, select this conversation, and verify:

- Headings, lists, code fences, tables, links, and images display structurally instead of as literal Markdown markers.
- Raw safe HTML such as `details` remains usable.
- Only final Codex answers appear.
- Clicking a user-message outline item still jumps immediately.
- The server log contains no static 404 or module-load errors.

Keep the new server running for the user after verification.
