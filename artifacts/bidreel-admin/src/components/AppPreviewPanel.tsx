import { useState, useRef, useCallback } from "react";
import { RefreshCw, ExternalLink, Smartphone, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const APP_URL =
  (import.meta.env.VITE_APP_PREVIEW_URL as string | undefined) ??
  "https://bid-reel.com";

type Lang = "en" | "ar";

interface Screen {
  label: string;
  labelAr: string;
  path: string;
  group: "entry" | "auth" | "onboarding" | "app";
  stateNote?: string;
}

const SCREENS: Screen[] = [
  { label: "Splash",        labelAr: "بداية",      path: "/",                     group: "entry",      stateNote: "App launch" },
  { label: "Sign in",       labelAr: "دخول",       path: "/login",                group: "auth",       stateNote: "Logged out" },
  { label: "Sign up",       labelAr: "تسجيل",      path: "/login?tab=signup",     group: "auth",       stateNote: "New user" },
  { label: "Setup",         labelAr: "الملف",      path: "/interests",            group: "onboarding", stateNote: "First login" },
  { label: "Feed",          labelAr: "المزادات",   path: "/feed",                 group: "app",        stateNote: "Logged in" },
  { label: "Explore",       labelAr: "استكشاف",    path: "/explore",              group: "app",        stateNote: "Logged in" },
];

export function AppPreviewPanel() {
  const [screen, setScreen] = useState<Screen>(SCREENS[1]);
  const [lang, setLang]     = useState<Lang>("en");
  const [key, setKey]       = useState(0);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const buildUrl = useCallback(
    (s: Screen, l: Lang) => {
      const base = APP_URL.replace(/\/$/, "");
      const sep  = s.path.includes("?") ? "&" : "?";
      return `${base}${s.path}${sep}lang=${l}`;
    },
    [],
  );

  const fullUrl = buildUrl(screen, lang);

  const navigate = (s: Screen) => {
    setScreen(s);
    setLoading(true);
    setKey((k) => k + 1);
  };

  const switchLang = (l: Lang) => {
    setLang(l);
    setLoading(true);
    setKey((k) => k + 1);
  };

  const refresh = useCallback(() => {
    setLoading(true);
    setKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col h-full gap-2 min-h-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Smartphone size={13} className="text-primary" />
          <span className="text-[10px] font-bold text-white tracking-wide uppercase">App Preview</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={refresh}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin text-primary" : ""} />
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
            title="Open in new tab"
          >
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* ── Controls: locale + screens in one compact row-set ── */}
      <div className="shrink-0 flex flex-col gap-1.5">

        {/* Locale toggle */}
        <div className="flex items-center gap-1.5">
          <Globe size={10} className="text-muted-foreground/40 shrink-0" />
          <div className="flex gap-0.5 rounded-md bg-muted/20 border border-border p-0.5">
            {(["en", "ar"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => switchLang(l)}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-semibold transition-all",
                  lang === l
                    ? "bg-primary/25 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l === "en" ? "EN" : "AR"}
              </button>
            ))}
          </div>

          {/* State badge inline */}
          {screen.stateNote && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
              <span className="text-[9px] text-muted-foreground/50 truncate">{screen.stateNote}</span>
            </div>
          )}
        </div>

        {/* Screen selector — single scrollable row per group */}
        <div className="flex flex-wrap gap-1">
          {SCREENS.map((s) => (
            <button
              key={s.path}
              onClick={() => navigate(s)}
              className={cn(
                "px-2 py-0.5 rounded-md text-[10px] font-medium transition-all border",
                screen.path === s.path
                  ? "bg-primary/20 text-primary border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent",
              )}
            >
              {lang === "ar" ? s.labelAr : s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Phone frame + iframe — flex-1 so it fills remaining height ── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
        {/*
          Use a wrapper that constrains both width and height, then let the
          phone scale to fill it while preserving a 9:16 portrait aspect ratio.
          CSS aspect-ratio does the right thing: if the container is wider than
          tall, height wins; if taller than wide, width wins.
        */}
        <div
          className="relative w-full h-full"
          style={{ maxWidth: "280px" }}
        >
          {/* Aspect-ratio sizer — invisible, drives the intrinsic height */}
          <div style={{ paddingBottom: "177.78%" /* 16/9 */ }} />

          {/* Absolutely-fill the aspect box */}
          <div className="absolute inset-0">

            {/* Outer shell */}
            <div className="absolute inset-0 rounded-[32px] border-[5px] border-white/10 bg-black/40 shadow-2xl pointer-events-none z-10" />

            {/* Notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-[12px] bg-black/90 rounded-full z-20 pointer-events-none" />

            {/* Home indicator */}
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-10 h-[3px] bg-white/20 rounded-full z-20 pointer-events-none" />

            {/* Loading overlay */}
            {loading && (
              <div className="absolute inset-[5px] rounded-[27px] bg-[#0d0d16] flex items-center justify-center" style={{ zIndex: 15 }}>
                <RefreshCw size={14} className="text-primary animate-spin" />
              </div>
            )}

            {/* Live iframe */}
            <iframe
              ref={iframeRef}
              key={key}
              src={fullUrl}
              title="BidReel App Preview"
              className="absolute inset-[5px] rounded-[27px] bg-[#0d0d16]"
              style={{ border: "none", width: "calc(100% - 10px)", height: "calc(100% - 10px)" }}
              onLoad={() => setLoading(false)}
              allow="fullscreen"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </div>
      </div>

      {/* ── URL hint ── */}
      <div className="shrink-0 text-center">
        <span className="text-[9px] text-muted-foreground/25 truncate block px-1">
          {fullUrl}
        </span>
      </div>
    </div>
  );
}
