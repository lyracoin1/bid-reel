import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, Gavel, Flag, BarChart3, LogOut, Shield, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAdminSession } from "./admin-session";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  { label: "لوحة التحكم",  path: "/admin",           icon: <LayoutDashboard size={18} /> },
  { label: "المستخدمون",   path: "/admin/users",      icon: <Users size={18} /> },
  { label: "المزادات",     path: "/admin/auctions",   icon: <Gavel size={18} /> },
  { label: "البلاغات",     path: "/admin/reports",    icon: <Flag size={18} /> },
  { label: "الإحصائيات",   path: "/admin/stats",      icon: <BarChart3 size={18} /> },
  { label: "سجل الأحداث",  path: "/admin/actions",    icon: <History size={18} /> },
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

      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
            <Shield size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">BidReel</div>
            <div className="text-[10px] text-violet-400 font-semibold uppercase tracking-widest">Admin</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" dir="rtl">
          {NAV.map((item) => {
            const isActive = item.path === "/admin"
              ? location === "/admin"
              : location.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => setLocation(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-right",
                  isActive
                    ? "bg-violet-600/20 text-violet-300 border border-violet-600/30"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800",
                )}
              >
                <span className={isActive ? "text-violet-400" : "text-gray-500"}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800" dir="rtl">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={18} />
            خروج من لوحة الأدمن
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="h-14 flex items-center px-6 border-b border-gray-800 bg-gray-900 shrink-0">
          <h1 className="text-base font-semibold text-white">{title}</h1>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
