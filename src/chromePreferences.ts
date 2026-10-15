export interface ChromePreferences {
  autoHideTopbar: boolean;
  hideTopbarByDefault: boolean;
  sidebarPinned: boolean;
  theme: "light" | "dark";
  darkPdf: boolean;
  automaticCompilation: boolean;
  interfaceSize: "auto" | "compact" | "comfortable" | "large";
  compactAwLinks: boolean;
}

export const chromePreferencesKey = "active-writing.chrome.v1";
export const defaultChromePreferences: ChromePreferences = { autoHideTopbar: false, hideTopbarByDefault: false, sidebarPinned: false, theme: "light", darkPdf: false, automaticCompilation: false, interfaceSize: "auto", compactAwLinks: true };

// These are app-wide appearance choices, not part of a paper or its saved work.
export function loadChromePreferences(storage?: Pick<Storage, "getItem">): ChromePreferences {
  try {
    const saved = JSON.parse(storage?.getItem(chromePreferencesKey) ?? "null");
    // The hide button changes this session only. Old saved hide choices must
    // not silently opt users into hiding the toolbar on every startup.
    return { autoHideTopbar: saved?.hideTopbarByDefault === true, hideTopbarByDefault: saved?.hideTopbarByDefault === true, sidebarPinned: saved?.sidebarPinned === true,
      theme: saved?.theme === "dark" ? "dark" : "light", darkPdf: saved?.darkPdf === true, automaticCompilation: saved?.automaticCompilation === true,
      interfaceSize: ["compact", "comfortable", "large"].includes(saved?.interfaceSize) ? saved.interfaceSize : "auto", compactAwLinks: saved?.compactAwLinks !== false };
  } catch { return { ...defaultChromePreferences }; }
}

export function saveChromePreferences(preferences: ChromePreferences, storage?: Pick<Storage, "setItem">): boolean {
  try { storage?.setItem(chromePreferencesKey, JSON.stringify(preferences)); return Boolean(storage); }
  catch { return false; }
}
