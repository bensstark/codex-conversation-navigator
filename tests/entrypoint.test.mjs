import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { isMainModule } from "../skill/conversation-navigator/scripts/entrypoint.mjs";

test("recognizes the invoked module through a symlink or Windows Junction", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "conversation-navigator-entrypoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const targetDirectory = join(root, "target");
  const aliasDirectory = join(root, "alias");
  await mkdir(targetDirectory);
  const targetFile = join(targetDirectory, "entry.mjs");
  await writeFile(targetFile, "export {};\n");

  try {
    await symlink(targetDirectory, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32") {
      t.skip(`Windows Junction unavailable: ${error.message}`);
      return;
    }
    throw error;
  }

  const aliasFile = join(aliasDirectory, "entry.mjs");
  assert.equal(
    isMainModule(pathToFileURL(targetFile).href, { argvPath: aliasFile }),
    true,
  );
});

test("does not mistake a different file for the main module", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "conversation-navigator-entrypoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, "first.mjs");
  const second = join(root, "second.mjs");
  await Promise.all([
    writeFile(first, "export {};\n"),
    writeFile(second, "export {};\n"),
  ]);

  assert.equal(
    isMainModule(pathToFileURL(first).href, { argvPath: second }),
    false,
  );
  assert.equal(
    isMainModule(pathToFileURL(first).href, { argvPath: undefined }),
    false,
  );
});

test("falls back to normalized paths when realpath is unavailable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "conversation-navigator-entrypoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "entry.mjs");
  await writeFile(file, "export {};\n");

  assert.equal(
    isMainModule(pathToFileURL(file).href, {
      argvPath: file,
      realpathSyncProcess() {
        throw new Error("realpath unavailable");
      },
    }),
    true,
  );
});
