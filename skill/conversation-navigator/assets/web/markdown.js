import createDOMPurify from "./vendor/purify.es.mjs";
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
  "cite", "datetime", "dir", "lang", "scope",
];
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const SAFE_TABLE_ALIGNMENTS = new Set(["left", "center", "right"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp)(?:;[^,]*)?,/i;
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

export function renderMarkdown(document, source, {
  parse = (value) => marked.parse(value, { async: false, gfm: true }),
  createPurifier = createDOMPurify,
} = {}) {
  const text = String(source ?? "");
  try {
    const purifier = createPurifier(document.defaultView);
    if (!purifier?.isSupported) {
      return textFragment(document, text);
    }
    const html = parse(text.replace(LEADING_ZERO_WIDTH, ""));
    const fragment = purifier.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
      SANITIZE_NAMED_PROPS: true,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
    hardenFragment(document, fragment);
    return fragment;
  } catch {
    return textFragment(document, text);
  }
}
