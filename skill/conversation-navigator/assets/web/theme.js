const THEME_STORAGE_KEY = "conversation-navigator-code-theme";
const DEFAULT_CODE_THEME = "dark";
const CODE_THEMES = new Set(["dark", "light"]);

function storageOrNull(storage) {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizeCodeTheme(value, fallback = DEFAULT_CODE_THEME) {
  const fallbackTheme = CODE_THEMES.has(fallback) ? fallback : DEFAULT_CODE_THEME;
  return CODE_THEMES.has(value) ? value : fallbackTheme;
}

export function readCodeTheme(storage, fallback = DEFAULT_CODE_THEME) {
  try {
    return normalizeCodeTheme(
      storageOrNull(storage)?.getItem(THEME_STORAGE_KEY),
      fallback,
    );
  } catch {
    return normalizeCodeTheme(null, fallback);
  }
}

export function writeCodeTheme(theme, storage) {
  try {
    storageOrNull(storage)?.setItem(THEME_STORAGE_KEY, normalizeCodeTheme(theme));
  } catch {
    // Theme preference is optional and must not block the viewer.
  }
}

export function setCodeTheme(documentNode, theme) {
  const resolved = normalizeCodeTheme(theme);
  documentNode?.body?.setAttribute("data-code-theme", resolved);
  return resolved;
}

export function updateThemeToggle(button, theme) {
  if (!button) {
    return;
  }
  const nextTheme = normalizeCodeTheme(theme) === "dark" ? "light" : "dark";
  const label = nextTheme === "light" ? "Light" : "Dark";
  const description = `Switch to ${nextTheme} theme`;
  button.textContent = label;
  button.setAttribute("aria-label", description);
  button.title = description;
  button.dataset.themeTarget = nextTheme;
}

export function initializeCodeTheme(documentNode, button, storage, fallback = DEFAULT_CODE_THEME) {
  let theme = setCodeTheme(documentNode, readCodeTheme(storage, fallback));
  updateThemeToggle(button, theme);
  button?.addEventListener("click", () => {
    theme = setCodeTheme(documentNode, theme === "dark" ? "light" : "dark");
    writeCodeTheme(theme, storage);
    updateThemeToggle(button, theme);
  });
  return theme;
}
