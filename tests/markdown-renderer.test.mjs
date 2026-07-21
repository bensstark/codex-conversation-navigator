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

**bold**, *emphasized*, and ~~gone~~\\
next line

- item
- [x] done

1. first
2. second

\`inline\`

\`\`\`js
const answer = 42;
\`\`\`

| left | center | right |
| :--- | :---: | ---: |
| a | b | c |

> quoted

---

<div><span><b>bold raw</b> <i>italic raw</i> <u>underlined</u> <s>struck</s>
<ins>inserted</ins> <abbr title="abbreviation">abbr</abbr> <cite>cite</cite>
<dfn>definition</dfn> <kbd>key</kbd> <mark>marked</mark> <q cite="/quote">quote</q>
<samp>sample</samp> <small>small</small> <sub>sub</sub> <sup>sup</sup>
<time datetime="2026-07-21">time</time> <var>variable</var>
<ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby> <bdi>isolate</bdi>
<bdo dir="rtl">direction</bdo><wbr></span></div>
<figure><figcaption>Caption</figcaption></figure>
<table><caption>Raw table</caption><colgroup><col span="2"></colgroup>
<thead><tr><th scope="col">Head</th></tr></thead><tbody><tr><td colspan="2">Body</td></tr></tbody>
<tfoot><tr><td>Foot</td></tr></tfoot></table>
<details open><summary>More</summary><p>Safe HTML</p></details>`);

  assert.equal(container.querySelector("h1")?.textContent, "Heading");
  assert.equal(container.querySelector("strong")?.textContent, "bold");
  assert.equal(container.querySelector("em")?.textContent, "emphasized");
  assert.equal(container.querySelector("del")?.textContent, "gone");
  assert.ok(container.querySelector("br"));
  assert.ok(container.querySelector("ul"));
  assert.ok(container.querySelector("ol"));
  const code = container.querySelector("pre code");
  assert.equal(code?.textContent.trim(), "const answer = 42;");
  assert.equal(code?.classList.contains("language-js"), true);
  assert.equal(code?.classList.contains("hljs"), true);
  assert.equal(code?.querySelector(".hljs-keyword")?.textContent, "const");
  const gfmTable = container.querySelector("table");
  assert.equal(gfmTable?.querySelectorAll("th")[0]?.getAttribute("align"), "left");
  assert.equal(gfmTable?.querySelectorAll("th")[1]?.getAttribute("align"), "center");
  assert.equal(gfmTable?.querySelectorAll("th")[2]?.getAttribute("align"), "right");
  assert.ok(container.querySelector("blockquote"));
  assert.ok(container.querySelector("hr"));
  for (const tag of [
    "div", "span", "b", "i", "u", "s", "ins", "abbr", "cite", "dfn", "kbd",
    "mark", "q", "samp", "small", "sub", "sup", "time", "var", "ruby", "rp",
    "rt", "bdi", "bdo", "wbr", "figure", "figcaption", "caption", "colgroup",
    "col", "thead", "tbody", "tfoot", "tr", "th", "td",
  ]) {
    assert.ok(container.querySelector(tag), `${tag} should survive sanitization`);
  }
  assert.equal(container.querySelector("details summary")?.textContent, "More");
  assert.equal(container.querySelector("details")?.hasAttribute("open"), true);
});

test("renderMarkdown sanitizes syntax-highlighter output", () => {
  const highlighter = {
    getLanguage() {
      return true;
    },
    highlight() {
      return {
        value: '<img src="x" onerror="alert(1)"><span class="hljs-keyword forged" onclick="alert(1)">const</span> answer = 42;',
      };
    },
  };
  const { container } = render("```js\nconst answer = 42;\n```", { highlighter });
  const code = container.querySelector("pre code");

  assert.equal(code?.querySelector("img"), null);
  assert.equal(code?.querySelector("[onclick]"), null);
  assert.equal(code?.querySelector("span")?.getAttribute("class"), "hljs-keyword");
  assert.equal(code?.classList.contains("hljs"), true);
  assert.equal(code?.textContent.trim(), "const answer = 42;");
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
<custom-element>custom text</custom-element>
<table background="https://bad.test/bg.png"><tbody><tr><td>allowed table text</td></tr></tbody></table>
<div role="main" data-role="user">allowed div text <span aria-label="takeover" data-test="forged">allowed span text</span></div>
<main>
  main text <canvas>canvas text</canvas><marquee>marquee text</marquee>
</main>`);

  assert.equal(
    container.querySelector(
      "script, style, form, button, iframe, object, embed, video, audio, source, svg, math, custom-element, main, canvas, marquee",
    ),
    null,
  );
  assert.equal(
    container.querySelector(
      "[id], [name], [class], [style], [srcset]",
    ),
    null,
  );
  const allowedTable = container.querySelector("table");
  assert.equal(allowedTable?.hasAttribute("background"), false);
  assert.match(allowedTable?.textContent ?? "", /allowed table text/);
  const allowedDiv = container.querySelector("div");
  assert.equal(allowedDiv?.hasAttribute("role"), false);
  assert.equal(allowedDiv?.hasAttribute("data-role"), false);
  assert.match(allowedDiv?.textContent ?? "", /allowed div text/);
  const allowedSpan = container.querySelector("span");
  assert.equal(allowedSpan?.hasAttribute("aria-label"), false);
  assert.equal(allowedSpan?.hasAttribute("data-test"), false);
  assert.match(allowedSpan?.textContent ?? "", /allowed span text/);
  assert.match(container.textContent, /main text/);
  assert.match(container.textContent, /canvas text/);
  assert.match(container.textContent, /marquee text/);
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
[protocol relative](//cdn.example.com/path)
[bad](tel:+123)

![remote](https://images.example.com/picture.png)
![data](data:image/png;base64,AA==)
<img alt="valid-min-max" src="https://images.example.com/valid.png" width="1" height="10000">
<img alt="valid-ordinary" src="https://images.example.com/valid.png" width="640" height="480">
<img alt="zero-negative" src="https://images.example.com/invalid.png" width="0" height="-1">
<img alt="decimal" src="https://images.example.com/invalid.png" width="1.5" height="2.0">
<img alt="units" src="https://images.example.com/invalid.png" width="10px" height="50%">
<img alt="leading-zero" src="https://images.example.com/invalid.png" width="01" height="0010">
<img alt="non-number" src="https://images.example.com/invalid.png" width="wide" height="high">
<img alt="too-large" src="https://images.example.com/invalid.png" width="10001" height="999999">
<img alt="svg" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
<img alt="ftp" src="ftp://example.com/picture.png">

<table width="999999" height="999999"><tbody><tr><td width="999999" height="999999">oversized</td></tr></tbody></table>
<hr width="999999" height="999999">

- [x] done

<input type="checkbox" disabled checked>
<input type="text" disabled value="bad">`);

  const links = [...container.querySelectorAll("a")];
  assert.equal(links.length, 6);
  for (const link of links) {
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.getAttribute("referrerpolicy"), "no-referrer");
  }
  assert.deepEqual(
    links.map((link) => link.getAttribute("href")),
    [
      "https://example.com/path",
      "/docs",
      "mailto:user@example.com",
      "#part",
      "//cdn.example.com/path",
      null,
    ],
  );

  const remote = container.querySelector('img[alt="remote"]');
  const data = container.querySelector('img[alt="data"]');
  for (const image of [remote, data]) {
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.equal(image.getAttribute("decoding"), "async");
    assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
  }
  assert.equal(remote.getAttribute("src"), "https://images.example.com/picture.png");
  assert.equal(data.getAttribute("src"), "data:image/png;base64,AA==");

  assert.deepEqual(
    ["valid-min-max", "valid-ordinary"].map((alt) => {
      const image = container.querySelector(`img[alt="${alt}"]`);
      return [image.getAttribute("width"), image.getAttribute("height")];
    }),
    [["1", "10000"], ["640", "480"]],
  );
  const oversizedTable = [...container.querySelectorAll("table")]
    .find((table) => table.textContent.includes("oversized"));
  const oversizedCell = oversizedTable.querySelector("td");
  const oversizedRule = container.querySelector("hr");
  for (const element of [oversizedTable, oversizedCell, oversizedRule]) {
    assert.equal(element.hasAttribute("width"), false);
    assert.equal(element.hasAttribute("height"), false);
  }
  for (const alt of [
    "zero-negative", "decimal", "units", "leading-zero", "non-number", "too-large",
  ]) {
    const image = container.querySelector(`img[alt="${alt}"]`);
    assert.equal(image.hasAttribute("width"), false, `${alt} width should be removed`);
    assert.equal(image.hasAttribute("height"), false, `${alt} height should be removed`);
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

test("renderMarkdown keeps disclosures but removes other interactive controls", () => {
  const { container } = render(`<details open><summary>Approved</summary><p>visible</p></details>
<dialog open>dialog</dialog>
<template><a href="https://bad.test">nested link</a><input type="checkbox" disabled></template>
<label for="outside">outside label</label>`);

  const details = container.querySelector("details");
  assert.equal(details?.hasAttribute("open"), true);
  assert.equal(details?.querySelector("summary")?.textContent, "Approved");
  assert.equal(container.querySelector("dialog, template, label"), null);
  assert.equal(container.querySelector("a, input"), null);
});

test("renderMarkdown strips control attributes and fixes link navigation", () => {
  const { container } = render(`<p for="outside" tabindex="0" draggable="true" contenteditable="true" autofocus popover="manual" popovertarget="outside" popovertargetaction="show">copy</p>
<a href="https://example.com/file" download="file.txt" ping="https://tracker.test">download link</a>`);

  assert.equal(
    container.querySelector(
      "[download], [ping], [for], [tabindex], [draggable], [contenteditable], [autofocus], [popover], [popovertarget], [popovertargetaction]",
    ),
    null,
  );

  const link = container.querySelector("a");
  assert.equal(link?.getAttribute("href"), "https://example.com/file");
  assert.deepEqual(
    [...link.attributes].map(({ name }) => name).sort(),
    ["href", "referrerpolicy", "rel", "target"],
  );
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(link.getAttribute("referrerpolicy"), "no-referrer");
});

test("renderMarkdown rejects obfuscated schemes and allows protocol-relative URLs", () => {
  const { container } = render(`<a href="JaVaScRiPt:alert(1)">mixed case</a>
<a href="jav&#x61;script:alert(1)">decoded entity</a>
<a href="//example.com/path">protocol relative</a>`);

  const links = [...container.querySelectorAll("a")];
  assert.equal(links.length, 3);
  assert.equal(links[0].hasAttribute("href"), false);
  assert.equal(links[1].hasAttribute("href"), false);
  assert.equal(links[2].getAttribute("href"), "//example.com/path");
  for (const link of links) {
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.getAttribute("referrerpolicy"), "no-referrer");
  }
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
