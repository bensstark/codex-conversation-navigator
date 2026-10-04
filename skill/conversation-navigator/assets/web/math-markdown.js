import { Marked } from "./vendor/marked.esm.js";
import katex from "./vendor/katex/katex.mjs";

const DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

function mathToken(source, block = false) {
  const indentation = block ? source.match(/^ {0,3}/)[0].length : 0;
  const text = source.slice(indentation);
  const delimiter = DELIMITERS.find(({ left, display }) =>
    text.startsWith(left) && (!block || display));
  if (!delimiter || (delimiter.left === "$" && /^\s/.test(text.slice(1)))) {
    return undefined;
  }
  let depth = 0;
  for (let index = delimiter.left.length; index < text.length; index += 1) {
    if (depth === 0 && text.startsWith(delimiter.right, index)) {
      if (delimiter.left === "$"
          && (/\s/.test(text[index - 1]) || /\d/.test(text[index + 1] ?? ""))) {
        continue;
      }
      const end = indentation + index + delimiter.right.length;
      return {
        type: block ? "blockMath" : "inlineMath",
        raw: source.slice(0, end),
        text: text.slice(delimiter.left.length, index),
        display: delimiter.display,
      };
    }
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth = Math.max(0, depth - 1);
    } else if (text[index] === "\n" && delimiter.left === "$") {
      return undefined;
    }
  }
  return undefined;
}

// Tokenize before Markdown can consume backslashes, underscores, pipes, or <.
// Restore only our own placeholders after sanitizing all user-authored HTML.
export function parseMathMarkdown(source) {
  let prefix;
  do {
    prefix = `NAVMATH${Math.random().toString(36).slice(2)}X`;
  } while (source.includes(prefix));
  const formulas = new Map();
  const renderer = (token) => {
    const marker = `${prefix}${formulas.size}END`;
    formulas.set(marker, token);
    const tag = token.display ? "div" : "span";
    return `<${tag}>${marker}</${tag}>`;
  };
  const parser = new Marked({ async: false, gfm: true });
  parser.use({ extensions: [
    {
      name: "blockMath",
      level: "block",
      start: (source) => source.match(/^ {0,3}(?:\$\$|\\\[)/m)?.index,
      tokenizer: (source) => mathToken(source, true),
      renderer,
    },
    {
      name: "inlineMath",
      level: "inline",
      start: (source) => source.match(/\$|\\[([]/)?.index,
      tokenizer: (source) => mathToken(source),
      renderer,
    },
  ] });
  return { html: parser.parse(source), formulas };
}

export function restoreMath(document, fragment, formulas) {
  for (const element of fragment.querySelectorAll("span, div")) {
    if (element.childNodes.length !== 1 || element.firstChild.nodeType !== 3) {
      continue;
    }
    const token = formulas.get(element.textContent);
    if (!token) {
      continue;
    }
    try {
      const template = document.createElement("template");
      template.innerHTML = katex.renderToString(token.text, {
        displayMode: token.display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 50,
      });
      element.replaceWith(template.content);
    } catch {
      // Unsupported/malformed TeX must remain readable, never hide a message.
      element.replaceWith(document.createTextNode(token.raw));
    }
  }
}
