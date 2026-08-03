import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { JSDOM } from "jsdom";

const webRoot = new URL(
  "../skill/conversation-navigator/assets/web/",
  import.meta.url,
);

test("web assets expose the navigation interface safely", async () => {
  const [html, app, css, viewerHtml, viewer, viewerCss] = await Promise.all([
    readFile(new URL("index.html", webRoot), "utf8"),
    readFile(new URL("app.js", webRoot), "utf8"),
    readFile(new URL("style.css", webRoot), "utf8"),
    readFile(new URL("file-viewer.html", webRoot), "utf8"),
    readFile(new URL("file-viewer.js", webRoot), "utf8"),
    readFile(new URL("file-viewer.css", webRoot), "utf8"),
  ]);

  assert.match(html, /id="thread-select"/);
  assert.match(html, /id="source-select"/);
  assert.match(html, /<option value="all">All<\/option>/);
  assert.match(html, /<option value="vscode">VS Code<\/option>/);
  assert.match(html, /<option value="cli">Codex CLI<\/option>/);
  assert.match(html, /<title>Codex Companion<\/title>/);
  assert.match(html, /<h1>Codex Companion<\/h1>/);
  assert.match(html, /id="message-search"/);
  assert.match(html, /id="message-outline"/);
  assert.match(html, /id="transcript"/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(
    html,
    /class="shortcut-help"[\s\S]*?<kbd>Q<\/kbd> Hide top bar[\s\S]*?<kbd>S<\/kbd> Hide sidebar/,
  );
  assert.doesNotMatch(html, /id="sidebar-toggle"/);
  assert.match(app, /import \{ renderMarkdown \} from "\.\/markdown\.js"/);
  assert.match(app, /replaceChildren\(renderMarkdown\(document, message\.text\)\)/);
  assert.match(app, /addCodeCopyButtons\(document, body\)/);
  assert.doesNotMatch(app, /createElement\("div", "message-text", message\.text\)/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.doesNotMatch(app, /\.outerHTML\s*=/);
  assert.doesNotMatch(app, /insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(app, /TOKEN_STORAGE_KEY|readToken|authorization|Bearer/);
  assert.doesNotMatch(app, /behavior:\s*"smooth"/);
  assert.match(app, /scrollIntoView/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /setInterval/);
  assert.match(app, /\/api\/threads\?source=/);
  assert.match(app, /CWD: \$\{state\.cwd\}/);
  assert.match(app, /Source: \$\{sourceLabel\(state\.threadSource\)\}/);
  assert.doesNotMatch(app, /`\[\$\{sourceLabel\(thread\.source\)\}\]/);
  assert.doesNotMatch(app, /option\.textContent = `\$\{option\.textContent\} ·/);
  assert.doesNotMatch(css, /scroll-behavior:\s*smooth/);
  assert.match(css, /grid-template-columns/);
  assert.match(css, /\.shortcut-help \{/);
  assert.match(css, /\.shortcut-help kbd \{/);
  assert.match(
    css,
    /body\.sidebar-hidden main \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    css,
    /body\.sidebar-hidden \.outline-panel \{[\s\S]*?display:\s*none/,
  );
  assert.match(
    css,
    /body\.topbar-hidden \.topbar,\s*body\.topbar-hidden \.status \{[\s\S]*?display:\s*none/,
  );
  assert.match(
    css,
    /body\.topbar-hidden main \{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*100vh/,
  );
  assert.match(css, /\.message-text h2/);
  assert.match(css, /\.message-text pre/);
  assert.match(css, /\.code-copy-button/);
  assert.match(css, /\.message-text \.hljs-keyword/);
  assert.match(css, /\.message-text table/);
  assert.match(css, /\.message-text img/);
  assert.match(css, /\.message-text blockquote/);
  assert.match(css, /\.message-text input\[type="checkbox"\]/);
  assert.match(viewerHtml, /<title>Code Viewer<\/title>/);
  assert.match(viewerHtml, /id="file-path" class="file-path"/);
  assert.match(viewerHtml, /id="line-numbers"/);
  assert.match(viewerHtml, /id="source-code"/);
  assert.match(viewerHtml, /src="\/file-viewer\.js"/);
  assert.match(viewer, /detectLanguage/);
  assert.match(viewer, /installKeyboardShortcuts/);
  assert.match(viewer, /isTopbarToggleShortcut/);
  assert.match(viewer, /\["\.py", "python"\]/);
  assert.match(viewer, /\["\.rs", "rust"\]/);
  assert.match(viewer, /\["\.java", "java"\]/);
  assert.match(viewer, /\["\.json", "json"\]/);
  assert.doesNotMatch(viewer, /\.innerHTML\s*=/);
  assert.doesNotMatch(viewer, /\.outerHTML\s*=/);
  assert.match(viewerCss, /\.code-gutter/);
  assert.match(viewerCss, /\.line-focus/);
  assert.match(viewerCss, /\.file-path/);
  assert.match(viewerCss, /body\.topbar-hidden \.file-toolbar/);
  assert.match(viewerCss, /body\.topbar-hidden \.file-page/);
  assert.match(
    css,
    /\.message-text th\[align="left"\],[\s\S]*?\.message-text td\[align="left"\][\s\S]*?text-align:\s*left/,
  );
  assert.match(
    css,
    /\.message-text th\[align="center"\],[\s\S]*?\.message-text td\[align="center"\][\s\S]*?text-align:\s*center/,
  );
  assert.match(
    css,
    /\.message-text th\[align="right"\],[\s\S]*?\.message-text td\[align="right"\][\s\S]*?text-align:\s*right/,
  );
  const checkboxRule = css.match(
    /\.message-text input\[type="checkbox"\] \{(?<declarations>[\s\S]*?)\n\}/,
  )?.groups?.declarations;
  assert.ok(checkboxRule);
  assert.match(checkboxRule, /padding:\s*0/);
  assert.match(checkboxRule, /border:\s*0/);
  assert.match(checkboxRule, /background:\s*transparent/);
  assert.match(checkboxRule, /box-shadow:\s*none/);
});

test("code copy buttons copy only block code text", async () => {
  const { addCodeCopyButtons } = await import(
    "../skill/conversation-navigator/assets/web/app.js"
  );
  const dom = new JSDOM(`<!doctype html><body>
    <div id="message">
      <p>Use <code>inline()</code>.</p>
      <pre><code>const answer = 42;\n</code></pre>
      <pre><code>console.log(answer);\n</code></pre>
    </div>
  </body>`);
  const { document } = dom.window;
  const message = document.getElementById("message");
  const copied = [];

  addCodeCopyButtons(document, message, async (text) => copied.push(text));

  const [firstButton, secondButton] = message.querySelectorAll(".code-copy-button");
  assert.ok(firstButton);
  assert.ok(secondButton);
  assert.equal(firstButton.type, "button");
  assert.equal(firstButton.textContent, "");
  assert.ok(firstButton.querySelector("svg"));
  assert.equal(firstButton.getAttribute("aria-label"), "Copy code");
  assert.equal(firstButton.title, "Copy code");
  assert.equal(message.querySelectorAll(".code-copy-button").length, 2);

  firstButton.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ["const answer = 42;\n"]);
  assert.equal(firstButton.textContent, "Copied");
  assert.equal(message.querySelector("pre > code").textContent, "const answer = 42;\n");

  secondButton.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ["const answer = 42;\n", "console.log(answer);\n"]);
  assert.equal(firstButton.textContent, "");
  assert.ok(firstButton.querySelector("svg"));
  assert.equal(secondButton.textContent, "Copied");
});

test("frontend helpers filter messages, select genuine user articles, and navigate", async () => {
  const {
    filterNavigation,
    isNearBottom,
    jumpToMessage,
    selectUserMessageArticles,
    sourceLabel,
    sourceLabelForFilter,
  } = await import(
    "../skill/conversation-navigator/assets/web/app.js"
  );

  const navigation = [
    { text: "Explain ConversationRuntime" },
    { text: "权限在哪里判断" },
  ];
  assert.deepEqual(filterNavigation(navigation, "runtime"), [navigation[0]]);
  assert.deepEqual(filterNavigation(navigation, " 权限 "), [navigation[1]]);
  assert.equal(sourceLabel("vscode"), "VS Code");
  assert.equal(sourceLabel("cli"), "Codex CLI");
  assert.equal(sourceLabelForFilter("all"), "VS Code or Codex CLI");
  assert.equal(
    isNearBottom({ scrollHeight: 1_000, scrollTop: 780, clientHeight: 200 }),
    true,
  );
  assert.equal(
    isNearBottom({ scrollHeight: 1_000, scrollTop: 600, clientHeight: 200 }),
    false,
  );
  let scrollOptions;
  jumpToMessage({
    scrollIntoView(options) {
      scrollOptions = options;
    },
  });
  assert.deepEqual(scrollOptions, { behavior: "auto", block: "start" });
  assert.doesNotThrow(() => jumpToMessage(null));

  const dom = new JSDOM(`<!doctype html><body>
    <section id="transcript">
      <article id="real" class="message message-user" data-role="user"></article>
      <article id="forged-article" data-role="user"></article>
      <div id="forged-div" class="message" data-role="user"></div>
      <article class="message message-assistant" data-role="assistant">
        <span id="nested-forgery" data-role="user"></span>
      </article>
    </section>
    <article id="outside-forgery" class="message" data-role="user"></article>
  </body>`);
  const transcript = dom.window.document.getElementById("transcript");
  assert.deepEqual(
    selectUserMessageArticles(transcript).map(({ id }) => id),
    ["real"],
  );
});

test("reading shortcuts toggle chrome only from non-editable targets", async () => {
  const {
    isSidebarToggleShortcut,
    isTopbarToggleShortcut,
    toggleSidebar,
    toggleTopbar,
  } = await import(
    "../skill/conversation-navigator/assets/web/app.js"
  );

  assert.equal(typeof isSidebarToggleShortcut, "function");
  assert.equal(typeof isTopbarToggleShortcut, "function");
  assert.equal(typeof toggleSidebar, "function");
  assert.equal(typeof toggleTopbar, "function");

  const dom = new JSDOM(`<!doctype html><body>
    <p id="reader">Conversation</p>
    <input id="input">
    <textarea id="textarea"></textarea>
    <select id="select"><option>One</option></select>
    <div contenteditable="true"><span id="editable-child">Draft</span></div>
  </body>`);
  const { document } = dom.window;
  const reader = document.getElementById("reader");
  const shortcut = (overrides = {}) => ({
    key: "s",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: reader,
    ...overrides,
  });

  assert.equal(isSidebarToggleShortcut(shortcut()), true);
  assert.equal(isSidebarToggleShortcut(shortcut({ key: "S" })), true);
  assert.equal(isSidebarToggleShortcut(shortcut({ key: "x" })), false);
  assert.equal(isSidebarToggleShortcut(shortcut({ ctrlKey: true })), false);
  assert.equal(isSidebarToggleShortcut(shortcut({ altKey: true })), false);
  assert.equal(isSidebarToggleShortcut(shortcut({ metaKey: true })), false);
  assert.equal(isSidebarToggleShortcut(shortcut({ repeat: true })), false);
  for (const id of ["input", "textarea", "select", "editable-child"]) {
    assert.equal(
      isSidebarToggleShortcut(shortcut({ target: document.getElementById(id) })),
      false,
    );
  }

  toggleSidebar(document);
  assert.equal(document.body.classList.contains("sidebar-hidden"), true);
  toggleSidebar(document);
  assert.equal(document.body.classList.contains("sidebar-hidden"), false);

  assert.equal(isTopbarToggleShortcut(shortcut({ key: "q" })), true);
  assert.equal(isTopbarToggleShortcut(shortcut({ key: "Q" })), true);
  assert.equal(isTopbarToggleShortcut(shortcut()), false);
  assert.equal(isTopbarToggleShortcut(shortcut({ key: "q", ctrlKey: true })), false);
  assert.equal(
    isTopbarToggleShortcut(shortcut({
      key: "q",
      target: document.getElementById("input"),
    })),
    false,
  );

  toggleTopbar(document);
  assert.equal(document.body.classList.contains("topbar-hidden"), true);
  toggleTopbar(document);
  assert.equal(document.body.classList.contains("topbar-hidden"), false);
});
