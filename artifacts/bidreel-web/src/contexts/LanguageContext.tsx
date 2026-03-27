import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { type Language, type Direction, type TKey, TRANSLATIONS, LANGUAGE_DIR } from "@/lib/i18n";

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

const STORAGE_KEY = "bidreel_lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as Language) || "en";
  });

  const dir = LANGUAGE_DIR[lang];

  const setLang = (l: Language) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  };

  const t = (key: TKey): string => TRANSLATIONS[lang][key] ?? TRANSLATIONS.en[key] ?? key;

  // Apply dir + font to root element for proper RTL support
  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
    if (lang === "ar") {
      document.documentElement.style.fontFamily = "'Segoe UI', Tahoma, Arial, sans-serif";
    } else {
      document.documentElement.style.fontFamily = "";
    }
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
