import { ru } from "./ru";

export type LocaleStrings = typeof ru;

let currentLocale: LocaleStrings = ru;

export function t(): LocaleStrings {
  return currentLocale;
}

// For future: add locale switching
// export function setLocale(locale: 'ru') {
//   currentLocale = ru;
// }
