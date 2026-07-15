import { useEffect } from "react";

interface ShortcutMap {
  [key: string]: () => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
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

      if (shortcuts[shortcutKey]) {
        e.preventDefault();
        shortcuts[shortcutKey]();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  "ctrl+f": "Поиск по URL",
  "ctrl+shift+f": "Поиск в теле",
  "ctrl+e": "Экспорт",
  "ctrl+l": "Очистить всё",
  "ctrl+shift+e": "Экспорт в HAR",
  "ctrl+1": "Фильтр: Все",
  "ctrl+2": "Фильтр: Ошибки",
  "ctrl+3": "Фильтр: Медленные",
  "ctrl+4": "Фильтр: Консоль",
  "ctrl+shift+c": "Сравнение",
  "ctrl+shift+s": "Настройки",
  Escape: "Закрыть диалог",
};
