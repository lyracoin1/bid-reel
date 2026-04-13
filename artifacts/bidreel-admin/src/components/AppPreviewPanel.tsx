import { useState, useRef, useCallback } from "react";
import { RefreshCw, ExternalLink, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

const APP_URL =
  (import.meta.env.VITE_APP_PREVIEW_URL as string | undefined) ??
  "https://bid-reel.com";

interface Route {
  label: string;
  path: string;
}

const ROUTES: Route[] = [
  { label: "الرئيسية",    path: "/"          },
  { label: "تسجيل دخول", path: "/login"      },
  { label: "إنشاء حساب", path: "/login?tab=signup" },
  { label: "المزادات",   path: "/feed"       },
  { label: "إتمام الملف", path: "/interests" },
];

export function AppPreviewPanel() {
  const [route, setRoute] = useState("/");
  const [key, setKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fullUrl = `${APP_URL.replace(/\/$/, "")}${route}`;

  const refresh = useCallback(() => {
    setLoading(true);
    setKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Panel header */}
      <div className="flex items-center justify-between shrink-0" dir="rtl">
        <div className="flex items-center gap-2">
          <Smartphone size={15} className="text-primary" />
          <span className="text-xs font-semibold text-white">معاينة التطبيق</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            title="تحديث"
          >
            <RefreshCw size={13} className={loading ? "animate-spin text-primary" : ""} />
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            title="فتح في تبويب جديد"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>

      {/* Route switcher */}
      <div className="flex gap-1 shrink-0 flex-wrap" dir="rtl">
        {ROUTES.map((r) => (
          <button
            key={r.path}
            onClick={() => {
              setRoute(r.path);
              setLoading(true);
              setKey((k) => k + 1);
            }}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all",
              route === r.path
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Phone frame + iframe */}
      <div className="flex-1 flex items-start justify-center overflow-hidden">
        <div className="relative w-[280px]" style={{ height: "calc(100% - 8px)" }}>
          {/* Phone shell */}
          <div className="absolute inset-0 rounded-[36px] border-[6px] border-white/10 bg-black/30 shadow-2xl pointer-events-none z-10" />

          {/* Notch */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-16 h-4 bg-black/80 rounded-full z-20 pointer-events-none" />

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-[6px] rounded-[30px] bg-[#0d0d16] z-10 flex items-center justify-center">
              <RefreshCw size={18} className="text-primary animate-spin" />
            </div>
          )}

          {/* Live iframe of the current app */}
          <iframe
            ref={iframeRef}
            key={key}
            src={fullUrl}
            title="BidReel App Preview"
            className="absolute inset-[6px] rounded-[30px] w-[calc(100%-12px)] h-[calc(100%-12px)] bg-[#0d0d16]"
            style={{ border: "none" }}
            onLoad={() => setLoading(false)}
            allow="fullscreen"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>

      {/* URL hint */}
      <div className="shrink-0 text-center">
        <span className="text-[10px] text-muted-foreground/40 truncate block px-2">
          {fullUrl}
        </span>
      </div>
    </div>
  );
}
