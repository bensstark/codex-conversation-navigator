import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import {
  initializeCodeTheme,
  normalizeCodeTheme,
  readCodeTheme,
} from "../skill/conversation-navigator/assets/web/theme.js";

function createStorage(initial = null) {
  let value = initial;
  return {
    getItem() {
      return value;
    },
    setItem(_key, nextValue) {
      value = nextValue;
    },
    get value() {
      return value;
    },
  };
}

test("code theme defaults safely and persists the toggle", () => {
  assert.equal(normalizeCodeTheme("unknown"), "dark");
  assert.equal(readCodeTheme(createStorage("light")), "light");

  const dom = new JSDOM(
    '<!doctype html><body data-code-theme="dark"><button id="theme"></button></body>',
    { url: "http://127.0.0.1/" },
  );
  const storage = createStorage();
  const button = dom.window.document.getElementById("theme");

  initializeCodeTheme(dom.window.document, button, storage);
  assert.equal(dom.window.document.body.dataset.codeTheme, "dark");
  assert.equal(button.textContent, "Light");
  assert.equal(button.getAttribute("aria-label"), "Switch to light theme");

  button.click();
  assert.equal(dom.window.document.body.dataset.codeTheme, "light");
  assert.equal(storage.value, "light");
  assert.equal(button.textContent, "Dark");
  assert.equal(button.getAttribute("aria-label"), "Switch to dark theme");
});
