import { en } from "./en";
import { ru } from "./ru";
import type { Language } from "../types";
import { setQaLanguage } from "../qa/messages";

export type LocaleStrings = typeof ru;
export type { Language };

const locales: Record<Language, LocaleStrings> = { ru, en };
let currentLanguage: Language = "ru";

/** Strings of the current interface language. */
export function t(): LocaleStrings {
  return locales[currentLanguage];
}

export function getLanguage(): Language {
  return currentLanguage;
}

/** Switches the language of t(); the caller re-renders the panel (see usePreferences). */
export function setLanguage(language: Language): void {
  currentLanguage = language in locales ? language : "ru";
  setQaLanguage(currentLanguage);
  if (typeof document !== "undefined") document.documentElement.lang = currentLanguage;
}

/** Locale tag for dates and numbers. */
export function dateLocale(): string {
  return currentLanguage === "ru" ? "ru-RU" : "en-GB";
}
