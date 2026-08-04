import { renderMarkdown } from "./markdown.js";
import { initializeCodeTheme } from "./theme.js";

const POLL_INTERVAL_MS = 2_000;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
let activeCopyButton = null;
const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

function isReadingShortcut(event, key) {
  if (typeof event?.key !== "string"
      || event.key.toLocaleLowerCase() !== key
      || event.ctrlKey
      || event.altKey
      || event.metaKey
      || event.repeat) {
    return false;
  }
  return typeof event.target?.closest !== "function"
    || !event.target.closest(EDITABLE_TARGET_SELECTOR);
}

export function isSidebarToggleShortcut(event) {
  return isReadingShortcut(event, "s");
}

export function isTopbarToggleShortcut(event) {
  return isReadingShortcut(event, "q");
}

export function toggleSidebar(documentNode) {
  documentNode?.body?.classList.toggle("sidebar-hidden");
}

export function toggleTopbar(documentNode) {
  documentNode?.body?.classList.toggle("topbar-hidden");
}

export function filterNavigation(navigation, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return navigation;
  }
  return navigation.filter((entry) =>
    entry.text.toLocaleLowerCase().includes(normalized));
}

export function isNearBottom({ scrollHeight, scrollTop, clientHeight }) {
  return scrollHeight - scrollTop - clientHeight <= 32;
}

export function jumpToMessage(target) {
  target?.scrollIntoView({ behavior: "auto", block: "start" });
}

export function selectUserMessageArticles(transcript) {
  return [...transcript.children].filter((child) =>
    child.matches('article.message[data-role="user"]'));
}

function showCopyIcon(button) {
  const documentNode = button.ownerDocument;
  const icon = documentNode.createElementNS(SVG_NAMESPACE, "svg");
  const rect = documentNode.createElementNS(SVG_NAMESPACE, "rect");
  const path = documentNode.createElementNS(SVG_NAMESPACE, "path");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  rect.setAttribute("x", "8");
  rect.setAttribute("y", "8");
  rect.setAttribute("width", "14");
  rect.setAttribute("height", "14");
  rect.setAttribute("rx", "2");
  path.setAttribute("d", "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2");
  icon.append(rect, path);
  button.replaceChildren(icon);
  button.setAttribute("aria-label", "Copy code");
  button.title = "Copy code";
}

export function addCodeCopyButtons(
  documentNode,
  container,
  writeText = (text) => globalThis.navigator.clipboard.writeText(text),
) {
  for (const code of container.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    const wrapper = documentNode.createElement("div");
    const button = documentNode.createElement("button");
    wrapper.className = "code-block";
    button.type = "button";
    button.className = "code-copy-button";
    showCopyIcon(button);
    button.addEventListener("click", async () => {
      if (activeCopyButton && activeCopyButton !== button) {
        showCopyIcon(activeCopyButton);
      }
      activeCopyButton = button;
      button.disabled = true;
      try {
        await writeText(code.textContent ?? "");
        if (activeCopyButton === button) {
          button.textContent = "Copied";
          button.setAttribute("aria-label", "Code copied");
          button.removeAttribute("title");
        }
      } catch {
        if (activeCopyButton === button) {
          button.textContent = "Failed";
          button.setAttribute("aria-label", "Copy failed");
          button.removeAttribute("title");
        }
      } finally {
        button.disabled = false;
      }
    });
    pre.before(wrapper);
    wrapper.append(pre, button);
  }
}

function createElement(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function threadLabel(thread) {
  return thread.name || thread.preview || `Thread ${thread.id.slice(0, 8)}`;
}

export function sourceLabel(source) {
  return source === "cli" ? "Codex CLI" : "VS Code";
}

export function sourceLabelForFilter(source) {
  return source === "all" ? "VS Code or Codex CLI" : sourceLabel(source);
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(typeof value === "number" && value < 10_000_000_000
    ? value * 1_000
    : value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function bootstrap() {
  const elements = {
    sourceSelect: document.getElementById("source-select"),
    threadSelect: document.getElementById("thread-select"),
    search: document.getElementById("message-search"),
    outline: document.getElementById("message-outline"),
    transcript: document.getElementById("transcript"),
    status: document.getElementById("status"),
    themeToggle: document.getElementById("theme-toggle"),
  };
  initializeCodeTheme(document, elements.themeToggle);
  const state = {
    source: elements.sourceSelect.value,
    cwd: "",
    threadSource: "",
    threadId: null,
    threadsSignature: "",
    threadSignature: "",
    navigation: [],
    activeMessageId: null,
    observer: null,
    loading: false,
    hasRenderedThread: false,
  };

  function setStatus(message, kind = "normal") {
    elements.status.textContent = state.cwd
      ? `${message} · CWD: ${state.cwd}`
      : message;
    elements.status.dataset.kind = kind;
  }

  async function api(path) {
    const response = await fetch(path, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  function setActiveMessage(messageId) {
    if (!messageId || state.activeMessageId === messageId) {
      return;
    }
    state.activeMessageId = messageId;
    for (const button of elements.outline.querySelectorAll("button")) {
      const active = button.dataset.messageId === messageId;
      button.classList.toggle("is-active", active);
      if (active) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }

  function renderOutline() {
    const entries = filterNavigation(state.navigation, elements.search.value);
    const fragment = document.createDocumentFragment();

    if (entries.length === 0) {
      fragment.append(createElement("p", "empty-note", state.navigation.length
        ? "No matching user messages"
        : "This thread has no user messages"));
    }

    entries.forEach((entry, index) => {
      const button = createElement("button", "outline-item");
      button.type = "button";
      button.dataset.messageId = entry.messageId;
      button.classList.toggle("is-active", entry.messageId === state.activeMessageId);
      if (entry.messageId === state.activeMessageId) {
        button.setAttribute("aria-current", "true");
      }
      button.append(
        createElement("span", "outline-number", String(index + 1).padStart(2, "0")),
        createElement("span", "outline-label", entry.label),
      );
      button.addEventListener("click", () => {
        jumpToMessage(document.getElementById(`message-${entry.messageId}`));
        setActiveMessage(entry.messageId);
      });
      fragment.append(button);
    });

    elements.outline.replaceChildren(fragment);
  }

  function observeVisibleMessages() {
    state.observer?.disconnect();
    state.observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) =>
          Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      if (visible[0]) {
        setActiveMessage(visible[0].target.dataset.messageId);
      }
    }, {
      root: elements.transcript,
      rootMargin: "0px 0px -72% 0px",
      threshold: 0,
    });

    for (const message of selectUserMessageArticles(elements.transcript)) {
      state.observer.observe(message);
    }
  }

  function renderTranscript(thread) {
    const followBottom = isNearBottom(elements.transcript);
    const previousScrollTop = elements.transcript.scrollTop;
    const fragment = document.createDocumentFragment();
    let firstUserMessageId = null;

    for (const turn of thread.turns) {
      for (const message of turn.messages) {
        const article = createElement("article", `message message-${message.role}`);
        article.id = `message-${message.id}`;
        article.dataset.role = message.role;
        article.dataset.messageId = message.id;
        const body = createElement("div", "message-text");
        body.replaceChildren(renderMarkdown(document, message.text));
        addCodeCopyButtons(document, body);
        article.append(
          createElement("p", "message-role", message.role === "user" ? "You" : "Codex"),
          body,
        );
        fragment.append(article);
        if (message.role === "user" && !firstUserMessageId) {
          firstUserMessageId = message.id;
        }
      }
    }

    if (!fragment.childNodes.length) {
      fragment.append(createElement("p", "empty-note transcript-empty", "This thread has no messages to display"));
    }

    elements.transcript.replaceChildren(fragment);
    elements.transcript.scrollTop = followBottom
      ? elements.transcript.scrollHeight
      : previousScrollTop;
    state.navigation = thread.navigation;
    if (!state.activeMessageId
        || !state.navigation.some((entry) => entry.messageId === state.activeMessageId)) {
      state.activeMessageId = firstUserMessageId;
    }
    renderOutline();
    observeVisibleMessages();
    state.hasRenderedThread = true;
  }

  function renderThreadOptions(threads) {
    const fragment = document.createDocumentFragment();
    for (const thread of threads) {
      const option = createElement("option", "", threadLabel(thread));
      option.value = thread.id;
      fragment.append(option);
    }
    elements.threadSelect.replaceChildren(fragment);
    elements.threadSelect.value = state.threadId || "";
    elements.threadSelect.disabled = threads.length === 0;
  }

  function renderNoThreads() {
    state.navigation = [];
    state.activeMessageId = null;
    state.hasRenderedThread = false;
    state.observer?.disconnect();
    elements.transcript.replaceChildren(
      createElement("p", "empty-note transcript-empty", `No ${sourceLabelForFilter(state.source)} conversations found for this project`),
    );
    renderOutline();
  }

  async function refresh() {
    if (state.loading) {
      return;
    }
    state.loading = true;
    try {
      const { cwd, threads } = await api(`/api/threads?source=${encodeURIComponent(state.source)}`);
      state.cwd = cwd;
      const threadsSignature = JSON.stringify(threads);
      const stillExists = threads.some((thread) => thread.id === state.threadId);
      if (!stillExists) {
        state.threadId = threads[0]?.id ?? null;
        state.threadSignature = "";
      }
      state.threadSource = threads.find((thread) => thread.id === state.threadId)?.source ?? "";
      if (threadsSignature !== state.threadsSignature) {
        state.threadsSignature = threadsSignature;
        renderThreadOptions(threads);
      }

      if (!state.threadId) {
        renderNoThreads();
        setStatus(`No ${sourceLabelForFilter(state.source)} conversations found for this project`);
        return;
      }

      const { thread } = await api(`/api/threads/${encodeURIComponent(state.threadId)}`);
      const threadSignature = JSON.stringify(thread);
      if (threadSignature !== state.threadSignature) {
        state.threadSignature = threadSignature;
        renderTranscript(thread);
      }
      setStatus(
        `Synced · ${formatTime(thread.updatedAt) || "just now"}`
        + (state.threadSource ? ` · Source: ${sourceLabel(state.threadSource)}` : ""),
      );
    } catch (error) {
      if (!state.hasRenderedThread) {
        elements.transcript.replaceChildren(
          createElement("p", "empty-note transcript-empty", "Unable to read conversations"),
        );
      }
      setStatus(`Sync failed: ${error.message}`, "error");
    } finally {
      state.loading = false;
    }
  }

  elements.sourceSelect.addEventListener("change", () => {
    state.source = elements.sourceSelect.value;
    state.threadId = null;
    state.threadsSignature = "";
    state.threadSignature = "";
    state.threadSource = "";
    state.activeMessageId = null;
    void refresh();
  });

  elements.threadSelect.addEventListener("change", () => {
    state.threadId = elements.threadSelect.value;
    state.threadSignature = "";
    state.activeMessageId = null;
    void refresh();
  });
  elements.search.addEventListener("input", renderOutline);
  document.addEventListener("keydown", (event) => {
    if (isSidebarToggleShortcut(event)) {
      toggleSidebar(document);
    } else if (isTopbarToggleShortcut(event)) {
      toggleTopbar(document);
    }
  });

  void refresh();
  window.setInterval(refresh, POLL_INTERVAL_MS);
}

if (typeof document !== "undefined") {
  bootstrap();
}
