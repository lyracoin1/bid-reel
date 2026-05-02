import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, Gavel, Flag, BarChart3, LogOut, History, Settings, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAdminSession } from "@/lib/admin-session";
import { NotificationBell } from "@/components/NotificationBell";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  { label: "لوحة التحكم",  path: "/",         icon: <LayoutDashboard size={18} /> },
  { label: "المستخدمون",   path: "/users",     icon: <Users size={18} /> },
  { label: "المزادات",     path: "/auctions",  icon: <Gavel size={18} /> },
  { label: "البلاغات",     path: "/reports",   icon: <Flag size={18} /> },
  { label: "الإحصائيات",   path: "/stats",     icon: <BarChart3 size={18} /> },
  { label: "سجل الأحداث",  path: "/actions",        icon: <History     size={18} /> },
  { label: "الصفقات الآمنة", path: "/secure-deals", icon: <ShieldCheck size={18} /> },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  title: string;
  /** When true, removes the default padding from <main> so children can fill the full height. */
  noPadding?: boolean;
}

export function AdminLayout({ children, title, noPadding = false }: AdminLayoutProps) {
  const [location, setLocation] = useLocation();

  async function handleLogout() {
    await clearAdminSession();
    setLocation("/login");
  }

  return (
    <div className="flex h-screen bg-[#030305] text-foreground font-sans overflow-hidden">

      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border">

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <img
            src={`${import.meta.env.BASE_URL}logo-icon.png`}
            alt="BidReel"
            className="w-9 h-9 rounded-xl box-glow shrink-0"
          />
          <div>
            <div className="text-sm font-display font-bold text-white leading-tight">BidReel</div>
            <div className="text-[10px] text-primary/70 font-semibold uppercase tracking-widest">Admin Panel</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto hide-scrollbar" dir="rtl">
          {NAV.map((item) => {
            const isActive = item.path === "/"
              ? location === "/"
              : location.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => setLocation(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-right",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                <span className={isActive ? "text-primary" : "text-muted-foreground"}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-sidebar-border space-y-0.5" dir="rtl">
          <button
            onClick={() => setLocation("/account")}
            className={cn(
              "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all",
              location === "/account"
                ? "bg-primary/15 text-primary border border-primary/25"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            <Settings size={17} className={location === "/account" ? "text-primary" : "text-muted-foreground"} />
            إعدادات الحساب
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          >
            <LogOut size={17} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-sidebar/80 backdrop-blur shrink-0">
          <h1 className="text-base font-display font-bold text-white">{title}</h1>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <span className="text-xs text-muted-foreground/40 pl-2 border-l border-border">
              admin.bid-reel.com
            </span>
          </div>
        </header>

        {/* Content */}
        <main className={cn("flex-1 overflow-hidden", noPadding ? "" : "overflow-y-auto p-6")}>
          {children}
        </main>
      </div>
    </div>
  );
}
