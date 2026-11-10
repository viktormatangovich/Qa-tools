import { useCallback, useEffect, useState } from 'react';
import type { FontSize } from '../components/settings/SettingsPanel';
import { getLanguage, setLanguage as applyLanguage } from '../locales';
import type { Language } from '../types';
import { loadStored, saveStored } from '../utils/storage';

/** Appearance, language and export preferences of the panel. */
export function usePreferences() {
  const [darkMode, setDarkMode] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  // On by default: tokens, passwords and cookies do not leave the browser in exported files.
  const [maskSecretsOnExport, setMaskSecretsOnExport] = useState(true);
  // t() reads a module-level language; this state exists to re-render the panel when it changes.
  const [language, setLanguage] = useState<Language>(getLanguage); // already read from storage in main.tsx

  useEffect(() => {
    void loadStored(['darkMode', 'fontSize', 'maskSecretsOnExport', 'language']).then((stored) => {
      if (stored.darkMode !== undefined) setDarkMode(stored.darkMode);
      if (stored.fontSize) setFontSize(stored.fontSize);
      if (stored.maskSecretsOnExport !== undefined) setMaskSecretsOnExport(stored.maskSecretsOnExport);
      if (stored.language === 'en' || stored.language === 'ru') {
        applyLanguage(stored.language);
        setLanguage(stored.language);
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.setAttribute('data-font-size', fontSize);
  }, [darkMode, fontSize]);

  const handleDarkModeChange = useCallback((enabled: boolean) => {
    setDarkMode(enabled);
    saveStored({ darkMode: enabled });
  }, []);

  const handleFontSizeChange = useCallback((size: FontSize) => {
    setFontSize(size);
    saveStored({ fontSize: size });
  }, []);

  const handleMaskSecretsChange = useCallback((enabled: boolean) => {
    setMaskSecretsOnExport(enabled);
    saveStored({ maskSecretsOnExport: enabled });
  }, []);

  const handleLanguageChange = useCallback((next: Language) => {
    applyLanguage(next);
    setLanguage(next);
    saveStored({ language: next });
  }, []);

  return {
    darkMode, fontSize, maskSecretsOnExport, language,
    handleDarkModeChange, handleFontSizeChange, handleMaskSecretsChange, handleLanguageChange,
  };
}
