import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, Gavel, Flag, BarChart3, LogOut, Shield, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAdminSession } from "@/lib/admin-session";

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
  { label: "سجل الأحداث",  path: "/actions",   icon: <History size={18} /> },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  title: string;
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  const [location, setLocation] = useLocation();

  function handleLogout() {
    clearAdminSession();
    setLocation("/login");
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-sans overflow-hidden">

      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shrink-0 shadow-lg shadow-violet-600/30">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">BidReel</div>
            <div className="text-[10px] text-violet-400 font-semibold uppercase tracking-widest">Admin Panel</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" dir="rtl">
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
                    ? "bg-violet-600/20 text-violet-300 border border-violet-600/30 shadow-sm"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/70",
                )}
              >
                <span className={isActive ? "text-violet-400" : "text-gray-500 group-hover:text-gray-400"}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-gray-800" dir="rtl">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={17} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-gray-800 bg-gray-900/80 backdrop-blur shrink-0">
          <h1 className="text-base font-semibold text-white">{title}</h1>
          <span className="text-xs text-gray-600">admin.bid-reel.com</span>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-6 bg-gray-950">
          {children}
        </main>
      </div>
    </div>
  );
}
