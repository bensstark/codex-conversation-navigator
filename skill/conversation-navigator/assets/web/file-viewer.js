import createDOMPurify from "./vendor/purify.es.mjs";
import hljs from "./vendor/highlight.min.js";
import { renderMarkdown } from "./markdown.js";
import { initializeCodeTheme } from "./theme.js";

const MAX_HIGHLIGHT_LENGTH = 100_000;
const SAFE_HIGHLIGHT_CLASS = /^hljs-[a-z0-9_-]+$/i;
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const FONT_SIZE_STEP = 1;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

const LANGUAGE_BY_FILE_NAME = new Map([
  ["dockerfile", "bash"],
  ["gnumakefile", "makefile"],
  ["makefile", "makefile"],
]);

const LANGUAGE_BY_EXTENSION = new Map([
  [".py", "python"],
  [".pyi", "python"],
  [".pyw", "python"],
  [".rs", "rust"],
  [".java", "java"],
  [".json", "json"],
  [".jsonc", "json"],
  [".jsonl", "json"],
  [".js", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".ts", "typescript"],
  [".cts", "typescript"],
  [".mts", "typescript"],
  [".tsx", "typescript"],
  [".go", "go"],
  [".c", "c"],
  [".h", "c"],
  [".cc", "cpp"],
  [".cpp", "cpp"],
  [".cxx", "cpp"],
  [".hh", "cpp"],
  [".hpp", "cpp"],
  [".cs", "csharp"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".swift", "swift"],
  [".sh", "bash"],
  [".bash", "bash"],
  [".zsh", "bash"],
  [".sql", "sql"],
  [".rb", "ruby"],
  [".php", "php"],
  [".pl", "perl"],
  [".pm", "perl"],
  [".lua", "lua"],
  [".r", "r"],
  [".html", "xml"],
  [".htm", "xml"],
  [".svg", "xml"],
  [".xml", "xml"],
  [".css", "css"],
  [".scss", "scss"],
  [".less", "less"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".mdown", "markdown"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".ini", "ini"],
  [".cfg", "ini"],
  [".conf", "ini"],
  [".toml", "ini"],
  [".diff", "diff"],
  [".patch", "diff"],
  [".gql", "graphql"],
  [".graphql", "graphql"],
  [".vb", "vbnet"],
]);

const LANGUAGE_LABELS = new Map([
  ["bash", "Bash / Shell"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["diff", "Diff"],
  ["go", "Go"],
  ["graphql", "GraphQL"],
  ["ini", "INI / TOML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["kotlin", "Kotlin"],
  ["less", "Less"],
  ["lua", "Lua"],
  ["makefile", "Makefile"],
  ["markdown", "Markdown"],
  ["objectivec", "Objective-C"],
  ["perl", "Perl"],
  ["php", "PHP"],
  ["python", "Python"],
  ["r", "R"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["scss", "SCSS"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["typescript", "TypeScript"],
  ["vbnet", "Visual Basic .NET"],
  ["xml", "HTML / XML"],
  ["yaml", "YAML"],
]);

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

export function isTopbarToggleShortcut(event) {
  return isReadingShortcut(event, "q");
}

export function toggleTopbar(documentNode) {
  documentNode?.body?.classList.toggle("topbar-hidden");
}

export function installKeyboardShortcuts(documentNode) {
  documentNode?.addEventListener("keydown", (event) => {
    if (isTopbarToggleShortcut(event)) {
      toggleTopbar(documentNode);
    }
  });
}

function fileName(filePath) {
  return String(filePath ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .pop() || "file";
}

export function isMarkdownPath(filePath) {
  const name = fileName(filePath).toLowerCase();
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf("."))
    : "";
  return MARKDOWN_EXTENSIONS.has(extension);
}

export function parseFileReference(value) {
  const reference = String(value ?? "").trim();
  const lineMatch = reference.match(/^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/);
  if (!lineMatch || !lineMatch[1]) {
    return { path: reference, line: null, column: null };
  }
  return {
    path: lineMatch[1],
    line: Number(lineMatch[2]),
    column: lineMatch[3] ? Number(lineMatch[3]) : null,
  };
}

export function detectLanguage(filePath, highlighter = hljs) {
  const name = fileName(filePath).toLowerCase();
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf("."))
    : "";
  const candidate = LANGUAGE_BY_FILE_NAME.get(name)
    ?? LANGUAGE_BY_EXTENSION.get(extension);
  if (!candidate || typeof highlighter?.getLanguage !== "function") {
    return null;
  }
  return highlighter.getLanguage(candidate) ? candidate : null;
}

export function languageLabel(language) {
  return LANGUAGE_LABELS.get(language) ?? "Plain text";
}

function sanitizeHighlight(purifier, html) {
  const fragment = purifier.sanitize(html, {
    ALLOWED_TAGS: ["span"],
    ALLOWED_ATTR: ["class"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_NAMED_PROPS: true,
  });
  for (const span of fragment.querySelectorAll("span[class]")) {
    const safeClasses = [...span.classList].filter((className) =>
      SAFE_HIGHLIGHT_CLASS.test(className));
    if (safeClasses.length) {
      span.setAttribute("class", safeClasses.join(" "));
    } else {
      span.removeAttribute("class");
    }
  }
  return fragment;
}

function lineInfo(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const count = Math.max(1, lines.length);
  const width = String(count).length;
  return {
    count,
    numbers: Array.from({ length: count }, (_, index) =>
      String(index + 1).padStart(width, " ")).join("\n"),
  };
}

function setLineFocus(document, elements, line) {
  if (!elements.focus || !line) {
    elements.focus?.setAttribute("hidden", "");
    if (elements.focus) {
      delete elements.focus.dataset.line;
    }
    return;
  }
  const computed = document.defaultView?.getComputedStyle(elements.codeContent);
  const lineHeight = Number.parseFloat(computed?.lineHeight ?? "") || 24;
  const paddingTop = Number.parseFloat(computed?.paddingTop ?? "") || 16;
  elements.focus.style.top = `${paddingTop + (line - 1) * lineHeight}px`;
  elements.focus.style.height = `${lineHeight}px`;
  elements.focus.dataset.line = String(line);
  elements.focus.removeAttribute("hidden");
}

export function clampFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_FONT_SIZE;
  }
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(numeric)));
}

export function setCodeFontSize(document, elements, value) {
  const size = clampFontSize(value);
  elements.scroll.style.setProperty("--code-font-size", `${size}px`);
  elements.fontSize.textContent = `${size}px`;
  const focusedLine = Number(elements.focus?.dataset.line);
  if (Number.isInteger(focusedLine) && focusedLine > 0) {
    setLineFocus(document, elements, focusedLine);
  }
  return size;
}

export function adjustCodeFontSize(document, elements, delta) {
  const current = Number.parseFloat(
    elements.scroll.style.getPropertyValue("--code-font-size"),
  ) || DEFAULT_FONT_SIZE;
  return setCodeFontSize(document, elements, current + delta);
}

export function setMarkdownViewMode(documentNode, elements, mode) {
  const rendered = mode === "rendered";
  elements.scroll.classList.toggle("markdown-rendered", rendered);
  elements.markdown.hidden = !rendered;
  elements.codeContent.hidden = rendered;
  elements.gutter.hidden = rendered;
  if (rendered) {
    setLineFocus(documentNode, elements, null);
  }

  if (elements.viewToggle) {
    const nextMode = rendered ? "source" : "rendered";
    const label = rendered ? "Source" : "Rendered";
    const description = rendered ? "Show Markdown source" : "Render Markdown";
    elements.viewToggle.textContent = label;
    elements.viewToggle.setAttribute("aria-label", description);
    elements.viewToggle.title = description;
    elements.viewToggle.dataset.viewMode = nextMode;
  }
  return rendered ? "rendered" : "source";
}

export function renderMarkdownViewer(documentNode, elements, source) {
  elements.markdown.replaceChildren(renderMarkdown(documentNode, source));
  setMarkdownViewMode(documentNode, elements, "rendered");
  return {
    mode: "rendered",
    lineCount: lineInfo(source).count,
  };
}

export function scrollToSourceLine(documentNode, elements, line) {
  if (!line) {
    return;
  }
  const lineCount = lineInfo(elements.code.textContent ?? "").count;
  if (line > lineCount) {
    return;
  }
  setLineFocus(documentNode, elements, line);
  const computed = documentNode.defaultView?.getComputedStyle(elements.codeContent);
  const lineHeight = Number.parseFloat(computed?.lineHeight ?? "") || 24;
  elements.scroll.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

export function renderCodeViewer(document, elements, source, {
  path = "",
  line = null,
  highlighter = hljs,
  createPurifier = createDOMPurify,
} = {}) {
  const text = String(source ?? "");
  const language = detectLanguage(path, highlighter);
  let highlighted = false;

  if (language && text.length <= MAX_HIGHLIGHT_LENGTH) {
    try {
      const purifier = createPurifier(document.defaultView);
      const result = highlighter.highlight(text, {
        language,
        ignoreIllegals: true,
      });
      if (purifier?.isSupported && typeof result?.value === "string") {
        elements.code.replaceChildren(sanitizeHighlight(purifier, result.value));
        elements.code.className = `language-${language} hljs`;
        highlighted = true;
      }
    } catch {
      // Keep the safe plain-text fallback when highlighting fails.
    }
  }

  if (!highlighted) {
    elements.code.textContent = text;
    elements.code.className = language ? `language-${language}` : "language-plaintext";
  }

  const lines = lineInfo(text);
  elements.gutter.textContent = lines.numbers;
  setLineFocus(document, elements, line && line <= lines.count ? line : null);
  return {
    language,
    lineCount: lines.count,
    highlighted,
  };
}

function elementsFor(document) {
  return {
    name: document.getElementById("file-name"),
    meta: document.getElementById("file-meta"),
    path: document.getElementById("file-path"),
    status: document.getElementById("file-status"),
    scroll: document.getElementById("code-scroll"),
    fontDecrease: document.getElementById("font-decrease"),
    fontIncrease: document.getElementById("font-increase"),
    fontSize: document.getElementById("font-size"),
    themeToggle: document.getElementById("theme-toggle"),
    viewToggle: document.getElementById("view-toggle"),
    gutter: document.getElementById("line-numbers"),
    codeContent: document.getElementById("code-content"),
    code: document.getElementById("source-code"),
    markdown: document.getElementById("markdown-content"),
    focus: document.getElementById("line-focus"),
    copy: document.getElementById("copy-file"),
  };
}

async function readLocalFile(reference) {
  const endpoint = new URL("/api/local-file", globalThis.location.href);
  endpoint.searchParams.set("path", reference);
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.text();
  if (!response.ok) {
    try {
      throw new Error(JSON.parse(body).error || `Request failed (${response.status})`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Request failed (${response.status})`);
      }
      throw error;
    }
  }
  return body;
}

async function bootstrap() {
  const elements = elementsFor(document);
  initializeCodeTheme(document, elements.themeToggle);
  setCodeFontSize(document, elements, DEFAULT_FONT_SIZE);
  elements.fontDecrease.addEventListener("click", () => {
    adjustCodeFontSize(document, elements, -FONT_SIZE_STEP);
  });
  elements.fontIncrease.addEventListener("click", () => {
    adjustCodeFontSize(document, elements, FONT_SIZE_STEP);
  });
  const reference = new URL(globalThis.location.href).searchParams.get("path");
  if (!reference) {
    elements.status.textContent = "No local file was specified.";
    return;
  }

  const location = parseFileReference(reference);
  const name = fileName(location.path);
  elements.name.textContent = name;
  elements.path.textContent = location.path;
  elements.path.title = location.path;

  try {
    const source = await readLocalFile(reference);
    const markdownFile = isMarkdownPath(location.path);
    const result = renderCodeViewer(document, elements, source, {
      path: location.path,
      line: location.line,
    });
    let viewMode = "source";
    if (markdownFile) {
      renderMarkdownViewer(document, elements, source);
      elements.viewToggle.removeAttribute("hidden");
      viewMode = "rendered";
      elements.viewToggle.addEventListener("click", () => {
        viewMode = setMarkdownViewMode(document, elements,
          viewMode === "rendered" ? "source" : "rendered");
        if (viewMode === "source") {
          scrollToSourceLine(document, elements, location.line);
        }
      });
    }
    const language = languageLabel(result.language);
    const lineSuffix = location.line ? ` · line ${location.line}` : "";
    const modeSuffix = markdownFile ? " · rendered" : "";
    const highlightSuffix = markdownFile || result.highlighted ? "" : " · plain text";
    elements.meta.textContent = `${language} · ${result.lineCount} lines${lineSuffix}${modeSuffix}${highlightSuffix}`;
    elements.status.textContent = "Ready";
    elements.status.setAttribute("hidden", "");
    elements.scroll.removeAttribute("hidden");
    elements.copy.removeAttribute("disabled");
    elements.copy.addEventListener("click", async () => {
      try {
        await globalThis.navigator.clipboard.writeText(source);
        elements.copy.textContent = "Copied";
      } catch {
        elements.copy.textContent = "Copy failed";
      }
    });

    if (location.line && !markdownFile) {
      scrollToSourceLine(document, elements, location.line);
    }
  } catch (error) {
    elements.status.removeAttribute("hidden");
    elements.status.textContent = error.message;
    elements.status.dataset.kind = "error";
  }
}

if (typeof document !== "undefined" && document.getElementById("source-code")) {
  installKeyboardShortcuts(document);
  void bootstrap();
}
