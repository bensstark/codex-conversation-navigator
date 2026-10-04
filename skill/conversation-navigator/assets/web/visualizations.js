// Only these explicit directives create frames; arbitrary Markdown HTML cannot.
export function visualizationDirectives(source) {
  const result = [];
  const pattern = /\uE200visualize\uE202([^\uE201]{1,8192})\uE201/g;
  for (const match of String(source ?? "").matchAll(pattern)) {
    try {
      const value = JSON.parse(match[1]);
      if (typeof value?.path !== "string" || value.path.length > 4096
          || !/\.html?$/i.test(value.path) || /[\r\n\0]/.test(value.path)) continue;
      result.push({ text: match[0], index: match.index, path: value.path,
        title: typeof value.title === "string" ? value.title.slice(0, 160) : "互动图" });
    } catch { /* Leave malformed directives readable as ordinary text. */ }
  }
  return result;
}

const registeredWindows = new WeakSet();

function listenForFrameSize(document) {
  const win = document.defaultView;
  if (!win || registeredWindows.has(win)) return;
  registeredWindows.add(win);
  win.addEventListener("message", (event) => {
    if (event.data?.type !== "navigator-visualization-size"
        || !Number.isFinite(event.data.height)) return;
    // Sandboxed frames have an opaque origin: authenticate by their window,
    // never trust a message merely because it claims the expected type.
    for (const frame of document.querySelectorAll("iframe.inline-visualization")) {
      if (event.source !== frame.contentWindow) continue;
      frame.style.height = `${Math.max(160, Math.min(2000, Math.ceil(event.data.height)))}px`;
      break;
    }
  });
}

export function renderInlineVisualizations(document, fragment, threadId) {
  if (!threadId) return;
  listenForFrameSize(document);
  const walker = document.createTreeWalker(fragment, 4 /* SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest("pre, code, a, .katex")
        && node.textContent.includes("\uE200visualize\uE202")) nodes.push(node);
  }
  for (const node of nodes) {
    const directives = visualizationDirectives(node.textContent);
    if (!directives.length) continue;
    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const directive of directives) {
      replacement.append(document.createTextNode(node.textContent.slice(offset, directive.index)));
      const frame = document.createElement("iframe");
      frame.className = "inline-visualization";
      frame.title = directive.title;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("loading", "lazy");
      const url = new URL("/api/visualization", document.baseURI);
      url.searchParams.set("thread", threadId);
      url.searchParams.set("path", directive.path);
      frame.src = url.href;
      replacement.append(frame);
      offset = directive.index + directive.text.length;
    }
    replacement.append(document.createTextNode(node.textContent.slice(offset)));
    node.replaceWith(replacement);
  }
}
