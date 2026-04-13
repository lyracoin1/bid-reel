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
  { label: "Profile setup", labelAr: "الملف",      path: "/interests",            group: "onboarding", stateNote: "First login" },
  { label: "Feed",          labelAr: "المزادات",   path: "/feed",                 group: "app",        stateNote: "Logged in" },
  { label: "Explore",       labelAr: "استكشاف",    path: "/explore",              group: "app",        stateNote: "Logged in" },
];

const GROUPS: { key: Screen["group"]; label: string }[] = [
  { key: "entry",      label: "Entry" },
  { key: "auth",       label: "Auth" },
  { key: "onboarding", label: "Onboarding" },
  { key: "app",        label: "App" },
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
    <div className="flex flex-col h-full gap-3 min-h-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Smartphone size={14} className="text-primary" />
          <span className="text-[11px] font-bold text-white tracking-wide uppercase">App Preview</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={refresh}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin text-primary" : ""} />
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
            title="Open in new tab"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* ── Locale toggle ── */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Globe size={11} className="text-muted-foreground/50 shrink-0" />
        <div className="flex gap-0.5 rounded-lg bg-muted/20 border border-border p-0.5">
          {(["en", "ar"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => switchLang(l)}
              className={cn(
                "px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all",
                lang === l
                  ? "bg-primary/25 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l === "en" ? "EN" : "AR"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Screen selector ── */}
      <div className="flex flex-col gap-2 shrink-0">
        {GROUPS.map((group) => {
          const groupScreens = SCREENS.filter((s) => s.group === group.key);
          return (
            <div key={group.key}>
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1">
                {groupScreens.map((s) => (
                  <button
                    key={s.path}
                    onClick={() => navigate(s)}
                    className={cn(
                      "px-2 py-1 rounded-lg text-[11px] font-medium transition-all",
                      screen.path === s.path
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                    )}
                  >
                    {lang === "ar" ? s.labelAr : s.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── State badge ── */}
      {screen.stateNote && (
        <div className="shrink-0 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
          <span className="text-[10px] text-muted-foreground/50">{screen.stateNote}</span>
        </div>
      )}

      {/* ── Phone frame + iframe ── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
        <div className="relative w-[260px]" style={{ height: "min(calc(100% - 4px), calc(260px * 16 / 9))", minHeight: "400px" }}>

          {/* Outer shell */}
          <div className="absolute inset-0 rounded-[34px] border-[5px] border-white/10 bg-black/40 shadow-2xl pointer-events-none z-10" />

          {/* Notch */}
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-14 h-[14px] bg-black/90 rounded-full z-20 pointer-events-none" />

          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/20 rounded-full z-20 pointer-events-none" />

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-[5px] rounded-[29px] bg-[#0d0d16] z-15 flex items-center justify-center" style={{ zIndex: 15 }}>
              <RefreshCw size={16} className="text-primary animate-spin" />
            </div>
          )}

          {/* Live iframe */}
          <iframe
            ref={iframeRef}
            key={key}
            src={fullUrl}
            title="BidReel App Preview"
            className="absolute inset-[5px] rounded-[29px] bg-[#0d0d16]"
            style={{ border: "none", width: "calc(100% - 10px)", height: "calc(100% - 10px)" }}
            onLoad={() => setLoading(false)}
            allow="fullscreen"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>

      {/* ── URL hint ── */}
      <div className="shrink-0 text-center pb-0.5">
        <span className="text-[9px] text-muted-foreground/30 truncate block px-1">
          {fullUrl}
        </span>
      </div>
    </div>
  );
}
