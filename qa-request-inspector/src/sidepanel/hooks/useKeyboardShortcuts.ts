import { useEffect } from "react";
import type { LocaleStrings } from "../locales";

interface ShortcutMap {
  [key: string]: () => void;
}

/** `allowInInputs`: shortcuts that work while typing too (Ctrl+K opens the palette from a search field). */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, allowInInputs: string[] = []) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      // Letters by physical key: Ctrl+K also works with the Russian layout (where e.key is "л").
      const key = e.code?.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      // Build shortcut key
      const parts: string[] = [];
      if (ctrl) parts.push("ctrl");
      if (shift) parts.push("shift");
      if (alt) parts.push("alt");
      parts.push(key);
      const shortcutKey = parts.join("+");

      // Don't trigger shortcuts when typing in inputs
      if (typing && !allowInInputs.includes(shortcutKey)) return;
      if (shortcuts[shortcutKey]) {
        e.preventDefault();
        shortcuts[shortcutKey]();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts, allowInInputs]);
}

/** Shortcut → key of its description in the locale dictionary (read it with t()[key] at render time). */
export const DEFAULT_SHORTCUTS: Record<string, keyof LocaleStrings> = {
  "ctrl+k": "shortcutPalette",
  "ctrl+f": "shortcutSearchUrl",
  "ctrl+shift+f": "shortcutSearchBody",
  "ctrl+e": "shortcutExport",
  "ctrl+l": "shortcutClear",
  "ctrl+shift+e": "shortcutExportHar",
  "ctrl+1": "shortcutFilterAll",
  "ctrl+2": "shortcutFilterErrors",
  "ctrl+3": "shortcutFilterSlow",
  "ctrl+4": "shortcutFilterConsole",
  "ctrl+shift+c": "shortcutCompare",
  "ctrl+shift+s": "shortcutSettings",
  Escape: "shortcutClose",
};
