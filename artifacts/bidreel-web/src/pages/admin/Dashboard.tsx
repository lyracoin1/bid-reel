import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Users, Gavel, Activity, Flag, Loader2, AlertCircle,
  Ban, Shield, EyeOff, TrendingDown, CheckCircle, XCircle, Layers,
} from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { adminGetStats, type AdminStats } from "@/lib/admin-api";

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  onClick?: () => void;
}

export default function AdminDashboard() {
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
    {
      label: "إجمالي المستخدمين",
      value: stats.totalUsers,
      icon: <Users size={20} />,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      onClick: () => setLocation("/admin/users"),
    },
    {
      label: "عدد الأدمن",
      value: stats.totalAdmins,
      icon: <Shield size={20} />,
      color: "text-indigo-400",
      bg: "bg-indigo-500/10",
      border: "border-indigo-500/20",
      onClick: () => setLocation("/admin/users"),
    },
    {
      label: "المستخدمون المحظورون",
      value: stats.bannedUsers,
      icon: <Ban size={20} />,
      color: "text-rose-400",
      bg: "bg-rose-500/10",
      border: "border-rose-500/20",
      onClick: () => setLocation("/admin/users"),
    },
  ] : [];

  const auctionCards: StatCard[] = stats ? [
    {
      label: "إجمالي المزادات",
      value: stats.totalAuctions,
      icon: <Layers size={20} />,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      border: "border-violet-500/20",
      onClick: () => setLocation("/admin/auctions"),
    },
    {
      label: "المزادات النشطة",
      value: stats.activeAuctions,
      icon: <Activity size={20} />,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      onClick: () => setLocation("/admin/auctions"),
    },
    {
      label: "المزادات المنتهية",
      value: stats.endedAuctions,
      icon: <TrendingDown size={20} />,
      color: "text-gray-400",
      bg: "bg-gray-500/10",
      border: "border-gray-500/20",
      onClick: () => setLocation("/admin/auctions"),
    },
    {
      label: "المزادات المحذوفة",
      value: stats.removedAuctions,
      icon: <EyeOff size={20} />,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
      onClick: () => setLocation("/admin/auctions"),
    },
    {
      label: "إجمالي المزايدات",
      value: stats.totalBids,
      icon: <Gavel size={20} />,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
    },
  ] : [];

  const reportCards: StatCard[] = stats ? [
    {
      label: "إجمالي البلاغات",
      value: stats.totalReports,
      icon: <Flag size={20} />,
      color: "text-gray-400",
      bg: "bg-gray-500/10",
      border: "border-gray-500/20",
      onClick: () => setLocation("/admin/reports"),
    },
    {
      label: "البلاغات المعلّقة",
      value: stats.openReports,
      icon: <Flag size={20} />,
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      onClick: () => setLocation("/admin/reports"),
    },
    {
      label: "البلاغات المحلولة",
      value: stats.resolvedReports,
      icon: <CheckCircle size={20} />,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      onClick: () => setLocation("/admin/reports"),
    },
    {
      label: "البلاغات المرفوضة",
      value: stats.dismissedReports,
      icon: <XCircle size={20} />,
      color: "text-gray-400",
      bg: "bg-gray-500/10",
      border: "border-gray-500/20",
      onClick: () => setLocation("/admin/reports"),
    },
  ] : [];

  function CardGrid({ cards }: { cards: StatCard[] }) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            onClick={card.onClick}
            className={`border ${card.border} ${card.bg} rounded-xl p-4 flex flex-col gap-2.5 ${card.onClick ? "cursor-pointer hover:brightness-110 transition-all" : ""}`}
          >
            <div className={card.color}>{card.icon}</div>
            <div>
              <div className="text-2xl font-bold text-white leading-tight">
                {card.value.toLocaleString()}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 font-medium leading-snug" dir="rtl">
                {card.label}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <AdminLayout title="لوحة التحكم">
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
        <div className="space-y-6">
          <p className="text-xs text-gray-500 -mt-2">
            جميع الأرقام مسحوبة مباشرةً من قاعدة البيانات — تحديث فوري
          </p>

          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3" dir="rtl">المستخدمون</h2>
            <CardGrid cards={userCards} />
          </section>

          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3" dir="rtl">المزادات والمزايدات</h2>
            <CardGrid cards={auctionCards} />
          </section>

          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3" dir="rtl">البلاغات</h2>
            <CardGrid cards={reportCards} />
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
