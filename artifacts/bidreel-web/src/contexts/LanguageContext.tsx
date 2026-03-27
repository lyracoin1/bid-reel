import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  type Language, type Direction, type TKey, type CurrencyMode,
  TRANSLATIONS, LANGUAGE_DIR, CURRENCY_MAP,
} from "@/lib/i18n";

/** Format a raw number (no currency conversion) for display */
function buildFormatPrice(mode: CurrencyMode, lang: Language) {
  return function formatPrice(amount: number): string {
    // Always group thousands with locale-aware formatting
    const num = new Intl.NumberFormat("en-US").format(Math.round(amount));

    if (mode === "usd") {
      return `$${num}`;
    }

    const { flag, symbol, after } = CURRENCY_MAP[lang];
    if (after) {
      // e.g. 🇸🇦 2,450 ر.س  |  🇷🇺 2,450 ₽
      return `${flag} ${num} ${symbol}`;
    }
    // e.g. 🇺🇸 $2,450
    return `${flag} ${symbol}${num}`;
  };
}

interface LangCtx {
  lang: Language;
  dir: Direction;
  t: (key: TKey) => string;
  setLang: (l: Language) => void;
  currencyMode: CurrencyMode;
  setCurrencyMode: (m: CurrencyMode) => void;
  formatPrice: (amount: number) => string;
}

const LanguageContext = createContext<LangCtx>({
  lang: "en",
  dir: "ltr",
  t: (k) => k,
  setLang: () => {},
  currencyMode: "usd",
  setCurrencyMode: () => {},
  formatPrice: (n) => `$${n}`,
});

const LANG_KEY = "bidreel_lang";
const CURR_KEY = "bidreel_currency";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    return (localStorage.getItem(LANG_KEY) as Language) || "en";
  });

  const [currencyMode, setCurrencyModeState] = useState<CurrencyMode>(() => {
    return (localStorage.getItem(CURR_KEY) as CurrencyMode) || "usd";
  });

  const dir = LANGUAGE_DIR[lang];

  const setLang = (l: Language) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  };

  const setCurrencyMode = (m: CurrencyMode) => {
    setCurrencyModeState(m);
    localStorage.setItem(CURR_KEY, m);
  };

  const t = (key: TKey): string => TRANSLATIONS[lang][key] ?? TRANSLATIONS.en[key] ?? key;

  const formatPrice = buildFormatPrice(currencyMode, lang);

  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.style.fontFamily =
      lang === "ar" ? "'Segoe UI', Tahoma, Arial, sans-serif" : "";
  }, [lang, dir]);

  return (
    <LanguageContext.Provider value={{ lang, dir, t, setLang, currencyMode, setCurrencyMode, formatPrice }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
