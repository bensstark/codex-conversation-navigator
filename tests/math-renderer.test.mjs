import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { renderMarkdown } from "../skill/conversation-navigator/assets/web/markdown.js";
import { createNavigatorServer } from "../skill/conversation-navigator/scripts/server.mjs";

function render(source) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://127.0.0.1/" });
  const container = dom.window.document.createElement("div");
  container.append(renderMarkdown(dom.window.document, source));
  return container;
}

test("bundled KaTeX and fonts match the pinned npm package", async () => {
  const root = new URL("../", import.meta.url);
  const bundled = new URL("skill/conversation-navigator/assets/web/vendor/katex/", root);
  const upstream = new URL("node_modules/katex/", root);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  assert.equal(pkg.devDependencies.katex, "0.19.0");
  assert.equal(lock.packages["node_modules/katex"].version, "0.19.0");
  const text = async (url) => (await readFile(url, "utf8")).replaceAll("\r\n", "\n");
  for (const name of ["katex.mjs", "katex.min.css"]) {
    assert.equal(await text(new URL(name, bundled)), await text(new URL(`dist/${name}`, upstream)));
  }
  assert.equal(await text(new URL("LICENSE", bundled)), await text(new URL("LICENSE", upstream)));
  const fonts = (await readdir(new URL("dist/fonts/", upstream))).filter(name => name.endsWith(".woff2")).sort();
  assert.deepEqual((await readdir(new URL("fonts/", bundled))).sort(), fonts);
  for (const name of fonts) {
    assert.deepEqual(await readFile(new URL(`fonts/${name}`, bundled)), await readFile(new URL(`dist/fonts/${name}`, upstream)));
  }
});

test("renders both inline delimiters and both display delimiters", () => {
  const container = render(String.raw`Inline $a_1^2+b^2=c^2$ and \(\frac{1}{2}\).

$$
\sum_{k=1}^{n}k=\frac{n(n+1)}{2}
$$

\[
\int_0^1 x^2\,dx=\frac13
\]`);
  assert.equal(container.querySelectorAll(".katex").length, 4);
  assert.equal(container.querySelectorAll(".katex-display").length, 2);
  assert.equal(container.querySelectorAll("annotation").length, 4);
  assert.equal(container.querySelector("annotation").textContent, "a_1^2+b^2=c^2");
  assert.equal(container.querySelectorAll("em").length, 0);
  assert.ok(container.querySelector(".mfrac"));
  assert.doesNotMatch(container.textContent, /NAVMATH/);
});

test("TeX matrices, alignments, inequalities and table formulas survive Markdown", () => {
  const container = render(String.raw`\[
\begin{aligned}
A&=\begin{pmatrix}a_1&b\\c&d\end{pmatrix}\\
|x|&<\frac{1}{2}
\end{aligned}
\]

| Formula | Value |
| --- | --- |
| $P(A\mid B)$ | \(\frac{P(A\cap B)}{P(B)}\) |

**Inline** \(\left|x\right|\) and \[x^2\] in prose.`);
  assert.equal(container.querySelectorAll(".katex").length, 5);
  assert.equal(container.querySelectorAll("td .katex").length, 2);
  assert.ok(container.querySelector(".mtable"));
  assert.ok(container.querySelector("strong"));
  assert.equal(container.querySelectorAll(".katex-display").length, 2);
});

test("does not interpret math inside code, escaped dollars or prices", () => {
  const source = String.raw`Use \$20 and \$30 or pay $20 and $30.

\`$x^2$\` and \`\(a+b\)\`

\`\`\`latex
\[x^2\]
$$a+b$$
\`\`\``.replaceAll("\\`", "`");
  const container = render(source);
  assert.equal(container.querySelectorAll(".katex").length, 0);
  assert.match(container.querySelector("pre code").textContent, /\$\$a\+b\$\$/);
  assert.equal(container.querySelector("code").textContent, "$x^2$");
});

test("malformed and unsupported TeX remain readable", () => {
  const source = String.raw`Good $x^2$; unsupported \(\unknowncommand{x}\); unfinished \[\frac{1}{2}`;
  const container = render(source);
  assert.equal(container.querySelectorAll(".katex").length, 1);
  assert.ok(container.textContent.includes(String.raw`\(\unknowncommand{x}\)`));
  assert.match(container.textContent, /unfinished/);
});

test("untrusted HTML and TeX cannot create active content or trusted styles", () => {
  const container = render(String.raw`<span class="katex" style="position:fixed" onclick="alert(1)">fake</span>

\(\href{javascript:alert(1)}{click}\)

\(\htmlStyle{position:fixed}{x}\)

\(\text{<img src=x onerror=alert(1)>}\)`);
  assert.equal(container.querySelector("[onclick], [onerror], img, script"), null);
  assert.equal(container.querySelector('a[href^="javascript:"]'), null);
  assert.equal(container.querySelector('[style*="position:fixed"]'), null);
  assert.equal(container.querySelector('span[class="katex"]')?.textContent === "fake", false);
});

test("math JS, CSS, fonts are local and arbitrary vendor paths stay inaccessible", async (t) => {
  const server = await createNavigatorServer({
    client: { stop() {} },
    cwd: process.cwd(),
    webRoot: fileURLToPath(new URL("../skill/conversation-navigator/assets/web/", import.meta.url)),
    openUrl: false,
  });
  t.after(() => server.close());
  for (const [path, type] of [
    ["math-markdown.js", "text/javascript"],
    ["math.css", "text/css"],
    ["vendor/katex/katex.mjs", "text/javascript"],
    ["vendor/katex/katex.min.css", "text/css"],
    ["vendor/katex/fonts/KaTeX_Main-Regular.woff2", "font/woff2"],
  ]) {
    const response = await fetch(new URL(path, server.url));
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-type").startsWith(type), path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(response.headers.get("content-security-policy"), /style-src-attr 'unsafe-inline'/);
  }
  assert.equal((await fetch(new URL("vendor/katex/LICENSE", server.url))).status, 404);
  assert.equal((await fetch(new URL("vendor/katex/fonts/not-a-font.woff2", server.url))).status, 404);
});
