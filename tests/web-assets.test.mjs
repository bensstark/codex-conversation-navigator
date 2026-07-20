import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const webRoot = new URL(
  "../skill/conversation-navigator/assets/web/",
  import.meta.url,
);

test("web assets expose the navigation interface safely", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("index.html", webRoot), "utf8"),
    readFile(new URL("app.js", webRoot), "utf8"),
    readFile(new URL("style.css", webRoot), "utf8"),
  ]);

  assert.match(html, /id="thread-select"/);
  assert.match(html, /id="message-search"/);
  assert.match(html, /id="message-outline"/);
  assert.match(html, /id="transcript"/);
  assert.match(html, /src="\/app\.js"/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.doesNotMatch(app, /behavior:\s*"smooth"/);
  assert.match(app, /scrollIntoView/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /setInterval/);
  assert.doesNotMatch(css, /scroll-behavior:\s*smooth/);
  assert.match(css, /grid-template-columns/);
});

test("frontend helpers filter messages and detect bottom proximity", async () => {
  const { filterNavigation, isNearBottom, jumpToMessage } = await import(
    "../skill/conversation-navigator/assets/web/app.js"
  );

  const navigation = [
    { text: "Explain ConversationRuntime" },
    { text: "权限在哪里判断" },
  ];
  assert.deepEqual(filterNavigation(navigation, "runtime"), [navigation[0]]);
  assert.deepEqual(filterNavigation(navigation, " 权限 "), [navigation[1]]);
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
});
