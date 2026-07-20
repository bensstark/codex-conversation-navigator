import createDOMPurify from "./vendor/purify.es.mjs";
import { marked } from "./vendor/marked.esm.js";

const FORBID_TAGS = [
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "base", "meta", "link", "form", "button", "textarea", "select", "option",
  "video", "audio", "source", "track",
];
const FORBID_ATTR = ["style", "id", "name", "class", "srcset"];
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
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
      USE_PROFILES: { html: true },
      RETURN_DOM_FRAGMENT: true,
      SANITIZE_NAMED_PROPS: true,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      FORBID_TAGS,
      FORBID_ATTR,
    });
    hardenFragment(document, fragment);
    return fragment;
  } catch {
    return textFragment(document, text);
  }
}
