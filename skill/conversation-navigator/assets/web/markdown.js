import createDOMPurify from "./vendor/purify.es.mjs";
import hljs from "./vendor/highlight.min.js";
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
  "cite", "datetime", "dir", "lang", "scope", "class",
];
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "file:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const SAFE_TABLE_ALIGNMENTS = new Set(["left", "center", "right"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp)(?:;[^,]*)?,/i;
const SAFE_IMAGE_DIMENSION = /^(?:[1-9]\d{0,3}|10000)$/;
const SAFE_CODE_LANGUAGE_CLASS = /^language-([a-z0-9_+-]{1,50})$/i;
const SAFE_HIGHLIGHT_CLASS = /^hljs-[a-z0-9_-]+$/i;
const MAX_HIGHLIGHT_LENGTH = 100_000;
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

function isFileLink(document, value) {
  try {
    return new URL(value.trim(), document.baseURI).protocol === "file:";
  } catch {
    return /^file:/i.test(value.trim());
  }
}

function localFilePath(document, value) {
  let url;
  try {
    url = new URL(value.trim(), document.baseURI);
  } catch {
    return null;
  }
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) {
    return null;
  }

  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!path) {
    return null;
  }
  // A file URL on Windows includes a leading slash before the drive letter.
  if (/^\/[A-Za-z]:[\\/]/.test(path)) {
    path = path.slice(1);
  }

  return path;
}

function localFileEndpoint(document, value) {
  const path = localFilePath(document, value);
  if (!path) {
    return null;
  }

  const endpoint = new URL("/file-viewer.html", document.baseURI);
  endpoint.searchParams.set("path", path);
  return endpoint.href;
}

function lineFromPath(path) {
  const lineMatch = path?.match(/^(.*?):([1-9]\d*)(?::[1-9]\d*)?$/);
  return lineMatch?.[1] ? Number(lineMatch[2]) : null;
}

function localFileLine(document, value) {
  const filePath = localFilePath(document, value);
  if (filePath) {
    return lineFromPath(filePath);
  }

  let url;
  try {
    url = new URL(value.trim(), document.baseURI);
  } catch {
    return null;
  }
  if (url.origin !== new URL(document.baseURI).origin || !url.pathname.startsWith("/")) {
    return null;
  }
  try {
    return lineFromPath(decodeURIComponent(url.pathname));
  } catch {
    return null;
  }
}

function appendFileLineLabel(link, line) {
  if (!line) {
    return;
  }
  const label = link.textContent?.trim() ?? "";
  if (!label || /\(line\s+[1-9]\d*\)$/i.test(label)) {
    return;
  }
  link.textContent = `${label} (line ${line})`;
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
  for (const element of fragment.querySelectorAll("[class]")) {
    const languageClass = element.matches("pre > code")
      ? [...element.classList].find((className) => SAFE_CODE_LANGUAGE_CLASS.test(className))
      : null;
    if (languageClass) {
      element.setAttribute("class", languageClass);
    } else {
      element.removeAttribute("class");
    }
  }

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
    } else if (href !== null) {
      if (isFileLink(document, href)) {
        // Browsers cannot reliably open Linux/WSL file URLs, so open the local
        // read-only code viewer. The viewer fetches the constrained file endpoint.
        const endpoint = localFileEndpoint(document, href);
        if (endpoint) {
          link.setAttribute("href", endpoint);
        } else {
          link.removeAttribute("href");
        }
      }
      appendFileLineLabel(link, localFileLine(document, href));
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

function sanitizeMarkdown(purifier, html) {
  const allowFileHref = (_node, data) => {
    if (data.attrName === "href" && /^file:/i.test(data.attrValue)) {
      // DOMPurify does not allow file: by default; hardenFragment converts it
      // to a same-origin endpoint immediately after this sanitization pass.
      data.forceKeepAttr = true;
    }
  };
  const canManageHook = typeof purifier.addHook === "function"
    && typeof purifier.removeHook === "function";
  if (canManageHook) {
    purifier.addHook("uponSanitizeAttribute", allowFileHref);
  }
  try {
    return purifier.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
      SANITIZE_NAMED_PROPS: true,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  } finally {
    if (canManageHook) {
      purifier.removeHook("uponSanitizeAttribute", allowFileHref);
    }
  }
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

function highlightCodeBlocks(fragment, purifier, highlighter) {
  for (const code of fragment.querySelectorAll("pre > code")) {
    const source = code.textContent ?? "";
    if (!source.trim() || source.length > MAX_HIGHLIGHT_LENGTH) {
      continue;
    }

    try {
      const languageClass = [...code.classList]
        .find((className) => SAFE_CODE_LANGUAGE_CLASS.test(className));
      const language = languageClass?.match(SAFE_CODE_LANGUAGE_CLASS)?.[1];
      let result;
      if (language) {
        if (!highlighter.getLanguage(language)) {
          continue;
        }
        result = highlighter.highlight(source, { language, ignoreIllegals: true });
      } else {
        result = highlighter.highlightAuto(source);
      }
      if (typeof result?.value !== "string") {
        continue;
      }

      code.replaceChildren(sanitizeHighlight(purifier, result.value));
      code.classList.add("hljs");
    } catch {
      // Keep the already-sanitized plain code when highlighting fails.
    }
  }
}

export function renderMarkdown(document, source, {
  parse = (value) => marked.parse(value, { async: false, gfm: true }),
  createPurifier = createDOMPurify,
  highlighter = hljs,
} = {}) {
  const text = String(source ?? "");
  try {
    const purifier = createPurifier(document.defaultView);
    if (!purifier?.isSupported) {
      return textFragment(document, text);
    }
    const html = parse(text.replace(LEADING_ZERO_WIDTH, ""));
    const fragment = sanitizeMarkdown(purifier, html);
    hardenFragment(document, fragment);
    highlightCodeBlocks(fragment, purifier, highlighter);
    return fragment;
  } catch {
    return textFragment(document, text);
  }
}
