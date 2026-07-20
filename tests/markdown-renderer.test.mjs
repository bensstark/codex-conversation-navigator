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
