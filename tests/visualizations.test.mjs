import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { visualizationDirectives } from "../skill/conversation-navigator/assets/web/visualizations.js";
import { createNavigatorServer, parseCliArgs, readVisualization } from "../skill/conversation-navigator/scripts/server.mjs";
import { visualizationDocument } from "../skill/conversation-navigator/scripts/visualization-frame.mjs";

const directive = (path) => `\uE200visualize\uE202${JSON.stringify({path})}\uE201`;
const fixtureThread = (cwd, path, extra = "") => ({ id: "test-thread", cwd,
  turns: [{id:"turn", items:[{id:"message", type:"agentMessage", phase:"final_answer",
    text:`A formula: $x^2+y^2=1$\n\n${directive(path)}\n\n${extra}`}]}] });

test("directives: valid paths, invalid JSON, bounded payload", () => {
  assert.equal(visualizationDirectives(directive("C:/a.html"))[0].path, "C:/a.html");
  assert.equal(visualizationDirectives(directive("C:/a.txt")).length, 0);
  assert.equal(visualizationDirectives("\uE200visualize\uE202not json\uE201").length, 0);
  assert.equal(visualizationDirectives(directive("a".repeat(9000)+".html")).length, 0);
});

test("same-URL restart arguments", () => {
  assert.equal(parseCliArgs(["--port", "12306", "--no-open"]).port, 12306);
  for (const value of ["0", "65536", "NaN", "1.2"]) assert.throws(() => parseCliArgs(["--port",value]));
});

test("standalone documents and fragments get base styles and sizing bridge", () => {
  for (const source of ["<div>图</div>", "<!doctype html><html><head></head><body>图</body></html>"]) {
    const html = visualizationDocument(source);
    assert.match(html, /navigator-visualization-size/);
    assert.match(html, /--viz-series-1/);
    assert.match(html, /图/);
  }
});

test("file scope, reference validation, endpoint CSP and browser rendering", async (t) => {
  const temp = await mkdtemp(resolve(tmpdir(), "navigator-viz-test-"));
  const cwd = resolve(temp, "cwd"), visualizationRoot = resolve(temp, "visualizations");
  const plotRoot = resolve(visualizationRoot, "2026", "09", "01", "test-thread");
  await mkdir(cwd, {recursive:true});
  await mkdir(plotRoot, {recursive:true});
  const path = resolve(plotRoot, "plot.html");
  const source = `<h2>测试互动图</h2><input id="slider" type="range" value="2" min="1" max="10"><span id="value">2</span><svg width="300" height="140"><circle cx="80" cy="60" r="25" fill="var(--viz-series-1)"/></svg><script>document.querySelector('#slider').oninput=e=>document.querySelector('#value').textContent=e.target.value</script>`;
  await writeFile(path, source);
  const marker = directive(path.replaceAll("\\", "/"));
  const thread = fixtureThread(cwd, path.replaceAll("\\", "/"),
    `Inline code: \`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`\n\n<iframe src="/evil"></iframe><script>window.injected=true</script>\n\n\uE200visualize\uE202bad JSON\uE201`);
  const read = (requestedPath, options = {}) => readVisualization({cwd, visualizationRoot, thread, requestedPath, ...options});
  let server;
  try {
    await t.test("referenced per-thread HTML allowed", async () => assert.equal(await read(path), source));
    await t.test("cwd mismatch denied", async () => assert.rejects(read(path,{thread:{...thread,cwd:temp}}), /启动目录/));
    await t.test("nonreferenced file denied", async () => assert.rejects(read(resolve(plotRoot,"other.html")), /未被/));
    await t.test("other thread directory denied even if mentioned", async () => {
      const foreign = resolve(visualizationRoot,"2026","09","01","other-thread","plot.html");
      await assert.rejects(read(foreign,{thread:fixtureThread(cwd,foreign)}), /目录/);
    });
    await t.test("outside file denied even if mentioned", async () => {
      const outside = resolve(temp,"outside.html");
      await writeFile(outside,"private");
      await assert.rejects(read(outside,{thread:fixtureThread(cwd,outside)}), /目录/);
      const link = resolve(cwd,"escape.html");
      try { await symlink(outside, link); } catch (error) {
        if (["EPERM","EACCES"].includes(error.code)) {t.diagnostic("file symlink requires privileges; lexical escape test passed");return;}
        throw error;
      }
      await assert.rejects(read(link,{thread:fixtureThread(cwd,link)}), /之外/);
    });
    await t.test("large file rejected", async () => {
      const large = resolve(cwd,"large.html");
      await writeFile(large,"x".repeat(1024*1024+1));
      await assert.rejects(read(large,{thread:fixtureThread(cwd,large)}), /过大/);
    });
    server = await createNavigatorServer({cwd, visualizationRoot, idleMs:0, openUrl:false,
      client:{listThreads:async()=>[{id:thread.id,preview:"Test",source:"cli"}],readThread:async()=>thread,stop(){}}});
    const endpoint = new URL("/api/visualization",server.url);
    endpoint.searchParams.set("thread",thread.id); endpoint.searchParams.set("path",path);
    await t.test("HTTP sandbox policy and readable inline missing-file error", async () => {
      const response = await fetch(endpoint);
      assert.equal(response.status,200);
      const csp = response.headers.get("content-security-policy");
      assert.match(csp,/sandbox allow-scripts/); assert.match(csp,/connect-src 'none'/);
      assert.doesNotMatch(csp,/allow-same-origin/);
      endpoint.searchParams.set("path",resolve(plotRoot,"other.html"));
      const invalid = await fetch(endpoint); assert.equal(invalid.status,403);
      assert.match(await invalid.text(),/互动图无法显示/);
    });
    if (process.env.NAVIGATOR_PLAYWRIGHT_PATH) {
      await t.test("browser: inline controls, math, literal code, sanitization, sandbox, narrow layout", async () => {
        const require = createRequire(import.meta.url);
        const {chromium} = require(process.env.NAVIGATOR_PLAYWRIGHT_PATH);
        const browser = await chromium.launch({headless:true,
          ...(process.env.NAVIGATOR_CHROME_PATH ? {executablePath:process.env.NAVIGATOR_CHROME_PATH} : {})});
        try {
          const page = await browser.newPage({viewport:{width:1100,height:850}});
          const errors=[]; page.on("pageerror",e=>errors.push(String(e)));
          await page.goto(server.url);
          const iframe = page.locator("iframe.inline-visualization");
          await iframe.waitFor(); assert.equal(await iframe.count(),1);
          const frame = page.frameLocator("iframe.inline-visualization");
          await frame.locator("#slider").fill("8");
          assert.equal(await frame.locator("#value").innerText(),"8");
          assert.equal(await page.locator(".message-text .katex").count(),1);
          assert.ok((await page.locator("pre code").innerText()).includes(marker));
          assert.ok((await page.locator(".message-text").innerText()).includes("bad JSON"));
          assert.equal(await page.evaluate(()=>window.injected),undefined);
          const child = page.frames().find(f=>f!==page.mainFrame());
          assert.equal(await child.evaluate(()=>{try{parent.document.body;return false}catch{return true}}),true);
          assert.equal(await child.evaluate(async()=>{try{await fetch('/api/threads');return false}catch{return true}}),true);
          thread.updatedAt = Date.now();
          thread.turns.push({id:'new-turn',items:[{id:'new-message',type:'agentMessage',phase:'final_answer',text:'New synchronized message'}]});
          await page.getByText('New synchronized message',{exact:true}).waitFor();
          assert.equal(await frame.locator('#value').innerText(),'8', 'sync must not reload the interactive frame');
          await page.setViewportSize({width:390,height:800});
          assert.ok(await iframe.evaluate(el=>el.getBoundingClientRect().width>100));
          assert.deepEqual(errors,[]);
        } finally {await browser.close();}
      });
    }
  } finally {
    await server?.close();
    // Only the unique mkdtemp fixture directory owned by this test is removed.
    await rm(temp,{recursive:true,force:true});
  }
});
