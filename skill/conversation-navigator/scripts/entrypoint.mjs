import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

function pathApiFor(platform) {
  return platform === "win32" ? win32 : posix;
}

function canonicalPath(
  value,
  {
    platform = process.platform,
    realpathSyncProcess = realpathSync.native ?? realpathSync,
  } = {},
) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const pathApi = pathApiFor(platform);
  let absolute;
  try {
    absolute = pathApi.resolve(value);
  } catch {
    return null;
  }

  let resolved = absolute;
  try {
    resolved = realpathSyncProcess(absolute);
  } catch {
    // A missing/unreadable path still gets a safe lexical comparison below.
  }

  const normalized = pathApi.normalize(resolved);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Compare the invoked script path with this module's URL after resolving
 * symlinks/Junctions. Node can realpath `import.meta.url` while retaining the
 * alias in `process.argv[1]`, so comparing URL strings directly is unreliable.
 */
export function isMainModule(
  importMetaUrl,
  {
    argvPath = process.argv[1],
    platform = process.platform,
    realpathSyncProcess,
  } = {},
) {
  if (!argvPath || typeof importMetaUrl !== "string") {
    return false;
  }

  let modulePath;
  try {
    modulePath = fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }

  const options = { platform };
  if (realpathSyncProcess) {
    options.realpathSyncProcess = realpathSyncProcess;
  }
  const invokedPath = canonicalPath(argvPath, options);
  const currentPath = canonicalPath(modulePath, options);
  return invokedPath !== null && invokedPath === currentPath;
}
