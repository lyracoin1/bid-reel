import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Users, Gavel, Activity, Flag, Loader2, AlertCircle,
  Ban, Shield, EyeOff, TrendingDown, CheckCircle, XCircle, Layers,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { AppPreviewPanel } from "@/components/AppPreviewPanel";
import { DeployPanel } from "@/components/DeployPanel";
import { adminGetStats, type AdminStats } from "@/services/admin-api";

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  onClick?: () => void;
}

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    adminGetStats()
      .then(setStats)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const userCards: StatCard[] = stats ? [
    { label: "إجمالي المستخدمين",       value: stats.totalUsers,    icon: <Users size={18} />,      color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20",    onClick: () => setLocation("/users") },
    { label: "عدد الأدمن",              value: stats.totalAdmins,   icon: <Shield size={18} />,     color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20",  onClick: () => setLocation("/users") },
    { label: "محظورون",                  value: stats.bannedUsers,   icon: <Ban size={18} />,        color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20",    onClick: () => setLocation("/users") },
  ] : [];

  const auctionCards: StatCard[] = stats ? [
    { label: "إجمالي المزادات",  value: stats.totalAuctions,   icon: <Layers size={18} />,     color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", onClick: () => setLocation("/auctions") },
    { label: "نشطة",             value: stats.activeAuctions,  icon: <Activity size={18} />,   color: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20",onClick: () => setLocation("/auctions") },
    { label: "منتهية",           value: stats.endedAuctions,   icon: <TrendingDown size={18}/>,color: "text-gray-400",   bg: "bg-gray-500/10",   border: "border-gray-500/20",    onClick: () => setLocation("/auctions") },
    { label: "محذوفة",           value: stats.removedAuctions, icon: <EyeOff size={18} />,     color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20",  onClick: () => setLocation("/auctions") },
    { label: "مزايدات",          value: stats.totalBids,       icon: <Gavel size={18} />,      color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20" },
  ] : [];

  const reportCards: StatCard[] = stats ? [
    { label: "إجمالي",  value: stats.totalReports,    icon: <Flag size={18} />,        color: "text-gray-400",   bg: "bg-gray-500/10",   border: "border-gray-500/20",    onClick: () => setLocation("/reports") },
    { label: "معلّقة",  value: stats.openReports,     icon: <Flag size={18} />,        color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20",     onClick: () => setLocation("/reports") },
    { label: "محلولة",  value: stats.resolvedReports, icon: <CheckCircle size={18} />, color: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20", onClick: () => setLocation("/reports") },
    { label: "مرفوضة",  value: stats.dismissedReports,icon: <XCircle size={18} />,    color: "text-gray-400",   bg: "bg-gray-500/10",   border: "border-gray-500/20",    onClick: () => setLocation("/reports") },
  ] : [];

  function CardGrid({ cards }: { cards: StatCard[] }) {
    return (
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
        {cards.map((card) => (
          <div
            key={card.label}
            onClick={card.onClick}
            className={`border ${card.border} ${card.bg} rounded-xl p-3.5 flex flex-col gap-2 ${card.onClick ? "cursor-pointer hover:brightness-110 transition-all" : ""}`}
          >
            <div className={card.color}>{card.icon}</div>
            <div>
              <div className="text-xl font-bold text-white leading-tight">{card.value.toLocaleString()}</div>
              <div className="text-[11px] text-gray-400 mt-0.5 font-medium leading-snug" dir="rtl">{card.label}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <AdminLayout title="لوحة التحكم" noPadding>
      <div className="flex h-full overflow-hidden">

        {/* ── LEFT: Live app preview ─────────────────────────────────────────── */}
        <div className="w-[320px] shrink-0 border-r border-border bg-[#08080f] p-4 flex flex-col overflow-hidden">
          <AppPreviewPanel />
        </div>

        {/* ── RIGHT: Stats + deploy ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={28} className="text-violet-500 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          ) : (
            <div className="space-y-5" dir="rtl">

              {/* Deploy panel */}
              <DeployPanel />

              {/* User stats */}
              <section>
                <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
                  المستخدمون
                </h2>
                <CardGrid cards={userCards} />
              </section>

              {/* Auction stats */}
              <section>
                <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
                  المزادات والمزايدات
                </h2>
                <CardGrid cards={auctionCards} />
              </section>

              {/* Report stats */}
              <section>
                <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
                  البلاغات
                </h2>
                <CardGrid cards={reportCards} />
              </section>

            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
