import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  type Language, type Direction, type TKey,
  TRANSLATIONS, LANGUAGE_DIR,
} from "@/lib/i18n";

interface LangCtx {
  lang: Language;
  dir: Direction;
  t: (key: TKey) => string;
  setLang: (l: Language) => void;
}

const LanguageContext = createContext<LangCtx>({
  lang: "en",
  dir: "ltr",
  t: (k) => k,
  setLang: () => {},
});

const LANG_KEY = "bidreel_lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const urlLang = new URLSearchParams(window.location.search).get("lang");
    if (urlLang && ["en", "ar", "ru", "es", "fr", "tr"].includes(urlLang)) {
      return urlLang as Language;
    }
    return (localStorage.getItem(LANG_KEY) as Language) || "en";
  });

  const dir = LANGUAGE_DIR[lang];

  const setLang = (l: Language) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  };

  const t = (key: TKey): string => TRANSLATIONS[lang][key] ?? TRANSLATIONS.en[key] ?? key;

  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.style.fontFamily =
      lang === "ar" ? "'Segoe UI', Tahoma, Arial, sans-serif"
      : lang === "tr" ? "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      : "";
  }, [lang, dir]);

  return (
    <LanguageContext.Provider value={{ lang, dir, t, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
