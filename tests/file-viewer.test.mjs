import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import {
  detectLanguage,
  adjustCodeFontSize,
  clampFontSize,
  installKeyboardShortcuts,
  isTopbarToggleShortcut,
  languageLabel,
  parseFileReference,
  renderCodeViewer,
  setCodeFontSize,
  toggleTopbar,
} from "../skill/conversation-navigator/assets/web/file-viewer.js";

function createViewerDom() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="code-scroll">
      <button id="font-decrease"></button>
      <button id="font-increase"></button>
      <span id="font-size"></span>
      <div id="line-numbers"></div>
      <pre id="code-content"><code id="source-code"></code><span id="line-focus" hidden></span></pre>
    </div>
  </body>`);
  const { document } = dom.window;
  return {
    dom,
    document,
    elements: {
      scroll: document.getElementById("code-scroll"),
      fontDecrease: document.getElementById("font-decrease"),
      fontIncrease: document.getElementById("font-increase"),
      fontSize: document.getElementById("font-size"),
      gutter: document.getElementById("line-numbers"),
      codeContent: document.getElementById("code-content"),
      code: document.getElementById("source-code"),
      focus: document.getElementById("line-focus"),
    },
  };
}

test("parseFileReference separates path, line, and column", () => {
  assert.deepEqual(parseFileReference("/repo/src/main.py:12:4"), {
    path: "/repo/src/main.py",
    line: 12,
    column: 4,
  });
  assert.deepEqual(parseFileReference("C:\\repo\\Main.java:8"), {
    path: "C:\\repo\\Main.java",
    line: 8,
    column: null,
  });
  assert.deepEqual(parseFileReference("/repo/README"), {
    path: "/repo/README",
    line: null,
    column: null,
  });
});

test("detectLanguage supports common source and data file extensions", () => {
  const cases = [
    ["main.py", "python"],
    ["main.rs", "rust"],
    ["Main.java", "java"],
    ["package.json", "json"],
    ["app.ts", "typescript"],
    ["server.go", "go"],
    ["native.cpp", "cpp"],
    ["worker.kt", "kotlin"],
    ["build.sh", "bash"],
    ["query.sql", "sql"],
    ["README.md", "markdown"],
    ["config.yaml", "yaml"],
    ["index.html", "xml"],
    ["Dockerfile", "bash"],
  ];
  for (const [path, language] of cases) {
    assert.equal(detectLanguage(path), language, path);
    assert.notEqual(languageLabel(language), "Plain text");
  }
  assert.equal(detectLanguage("notes.txt"), null);
});

test("renderCodeViewer adds safe highlighting, line numbers, and line focus", () => {
  const { dom, document, elements } = createViewerDom();
  const source = "def greet(name):\n    return f\"hello {name}\"\n";

  const result = renderCodeViewer(document, elements, source, {
    path: "/repo/greet.py",
    line: 2,
  });

  assert.equal(result.language, "python");
  assert.equal(result.lineCount, 3);
  assert.equal(result.highlighted, true);
  assert.equal(elements.code.textContent, source);
  assert.equal(elements.code.classList.contains("hljs"), true);
  assert.equal(elements.code.querySelector(".hljs-keyword")?.textContent, "def");
  assert.equal(elements.gutter.textContent, "1\n2\n3");
  assert.equal(elements.focus.hasAttribute("hidden"), false);
  assert.match(elements.focus.style.top, /px$/);
  assert.equal(dom.window.document.querySelector("img"), null);
});

test("renderCodeViewer sanitizes highlighter output and falls back safely", () => {
  const { document, elements } = createViewerDom();
  const highlighter = {
    getLanguage() {
      return true;
    },
    highlight() {
      return {
        value: '<img src="x"><span class="hljs-keyword forged" onclick="alert(1)">def</span>',
      };
    },
  };

  const result = renderCodeViewer(document, elements, "def answer():", {
    path: "/repo/answer.py",
    highlighter,
  });

  assert.equal(result.highlighted, true);
  assert.equal(elements.code.querySelector("img"), null);
  assert.equal(elements.code.querySelector("[onclick]"), null);
  assert.equal(elements.code.querySelector("span")?.getAttribute("class"), "hljs-keyword");
});

test("code viewer Q shortcut hides and restores the top bar", () => {
  const { document } = createViewerDom();
  const event = (overrides = {}) => ({
    key: "q",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: document.body,
    ...overrides,
  });

  assert.equal(isTopbarToggleShortcut(event()), true);
  assert.equal(isTopbarToggleShortcut(event({ key: "Q" })), true);
  assert.equal(isTopbarToggleShortcut(event({ ctrlKey: true })), false);
  assert.equal(isTopbarToggleShortcut(event({ repeat: true })), false);

  installKeyboardShortcuts(document);
  document.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "q" }));
  assert.equal(document.body.classList.contains("topbar-hidden"), true);
  document.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "q" }));
  assert.equal(document.body.classList.contains("topbar-hidden"), false);

  toggleTopbar(document);
  assert.equal(document.body.classList.contains("topbar-hidden"), true);
});

test("code viewer font size controls clamp and update the code surface", () => {
  const { document, elements } = createViewerDom();

  assert.equal(clampFontSize(7), 10);
  assert.equal(clampFontSize(30), 24);
  assert.equal(clampFontSize("not-a-number"), 16);
  assert.equal(setCodeFontSize(document, elements, 18), 18);
  assert.equal(elements.scroll.style.getPropertyValue("--code-font-size"), "18px");
  assert.equal(elements.fontSize.textContent, "18px");
  assert.equal(adjustCodeFontSize(document, elements, 1), 19);
  assert.equal(adjustCodeFontSize(document, elements, -20), 10);
});
