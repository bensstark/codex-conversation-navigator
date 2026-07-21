import { renderMarkdown } from "./markdown.js";

const POLL_INTERVAL_MS = 2_000;
const TOKEN_STORAGE_KEY = "codex-conversation-navigator-token";
const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

export function isSidebarToggleShortcut(event) {
  if (typeof event?.key !== "string"
      || event.key.toLocaleLowerCase() !== "s"
      || event.ctrlKey
      || event.altKey
      || event.metaKey
      || event.repeat) {
    return false;
  }
  return typeof event.target?.closest !== "function"
    || !event.target.closest(EDITABLE_TARGET_SELECTOR);
}

export function toggleSidebar(documentNode) {
  documentNode?.body?.classList.toggle("sidebar-hidden");
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

function readToken() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return token;
  }
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

function threadLabel(thread) {
  return thread.name || thread.preview || `对话 ${thread.id.slice(0, 8)}`;
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
    threadSelect: document.getElementById("thread-select"),
    search: document.getElementById("message-search"),
    outline: document.getElementById("message-outline"),
    transcript: document.getElementById("transcript"),
    status: document.getElementById("status"),
  };
  const state = {
    token: readToken(),
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
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  async function api(path) {
    const response = await fetch(path, {
      headers: { authorization: `Bearer ${state.token}` },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `请求失败 (${response.status})`);
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
        ? "没有匹配的用户消息"
        : "这段对话还没有用户消息"));
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
        article.append(
          createElement("p", "message-role", message.role === "user" ? "你" : "Codex"),
          body,
        );
        fragment.append(article);
        if (message.role === "user" && !firstUserMessageId) {
          firstUserMessageId = message.id;
        }
      }
    }

    if (!fragment.childNodes.length) {
      fragment.append(createElement("p", "empty-note transcript-empty", "这段对话还没有可显示的消息"));
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
      const time = formatTime(thread.updatedAt);
      if (time) {
        option.textContent = `${option.textContent} · ${time}`;
      }
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
      createElement("p", "empty-note transcript-empty", "当前项目还没有 VS Code Codex 对话"),
    );
    renderOutline();
  }

  async function refresh() {
    if (state.loading || !state.token) {
      return;
    }
    state.loading = true;
    try {
      const { threads } = await api("/api/threads");
      const threadsSignature = JSON.stringify(threads);
      const stillExists = threads.some((thread) => thread.id === state.threadId);
      if (!stillExists) {
        state.threadId = threads[0]?.id ?? null;
        state.threadSignature = "";
      }
      if (threadsSignature !== state.threadsSignature) {
        state.threadsSignature = threadsSignature;
        renderThreadOptions(threads);
      }

      if (!state.threadId) {
        renderNoThreads();
        setStatus("没有找到当前项目的 VS Code Codex 对话");
        return;
      }

      const { thread } = await api(`/api/threads/${encodeURIComponent(state.threadId)}`);
      const threadSignature = JSON.stringify(thread);
      if (threadSignature !== state.threadSignature) {
        state.threadSignature = threadSignature;
        renderTranscript(thread);
      }
      setStatus(`已同步 · ${formatTime(thread.updatedAt) || "刚刚"}`);
    } catch (error) {
      if (!state.hasRenderedThread) {
        elements.transcript.replaceChildren(
          createElement("p", "empty-note transcript-empty", "暂时无法读取对话"),
        );
      }
      setStatus(`同步失败：${error.message}`, "error");
    } finally {
      state.loading = false;
    }
  }

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
    }
  });

  if (!state.token) {
    setStatus("缺少访问令牌，请从启动命令输出的完整地址重新打开。", "error");
    elements.threadSelect.disabled = true;
    elements.search.disabled = true;
    return;
  }

  void refresh();
  window.setInterval(refresh, POLL_INTERVAL_MS);
}

if (typeof document !== "undefined") {
  bootstrap();
}
