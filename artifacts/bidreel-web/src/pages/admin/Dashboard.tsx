import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Users, Gavel, Activity, Flag, Loader2, AlertCircle,
  Ban, Shield, EyeOff, ArrowLeft,
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

  const cards: StatCard[] = stats
    ? [
        {
          label: "إجمالي المستخدمين",
          value: stats.totalUsers,
          icon: <Users size={22} />,
          color: "text-blue-400",
          bg: "bg-blue-500/10",
          border: "border-blue-500/20",
          onClick: () => setLocation("/admin/users"),
        },
        {
          label: "إجمالي المزادات",
          value: stats.totalAuctions,
          icon: <Gavel size={22} />,
          color: "text-violet-400",
          bg: "bg-violet-500/10",
          border: "border-violet-500/20",
          onClick: () => setLocation("/admin/auctions"),
        },
        {
          label: "المزادات النشطة",
          value: stats.activeAuctions,
          icon: <Activity size={22} />,
          color: "text-emerald-400",
          bg: "bg-emerald-500/10",
          border: "border-emerald-500/20",
          onClick: () => setLocation("/admin/auctions"),
        },
        {
          label: "المزادات المحذوفة",
          value: stats.removedAuctions,
          icon: <EyeOff size={22} />,
          color: "text-orange-400",
          bg: "bg-orange-500/10",
          border: "border-orange-500/20",
          onClick: () => setLocation("/admin/auctions"),
        },
        {
          label: "إجمالي المزايدات",
          value: stats.totalBids,
          icon: <ArrowLeft size={22} style={{ transform: "rotate(225deg)" }} />,
          color: "text-amber-400",
          bg: "bg-amber-500/10",
          border: "border-amber-500/20",
        },
        {
          label: "البلاغات المعلّقة",
          value: stats.openReports,
          icon: <Flag size={22} />,
          color: "text-red-400",
          bg: "bg-red-500/10",
          border: "border-red-500/20",
          onClick: () => setLocation("/admin/reports"),
        },
        {
          label: "المستخدمون المحظورون",
          value: stats.bannedUsers,
          icon: <Ban size={22} />,
          color: "text-rose-400",
          bg: "bg-rose-500/10",
          border: "border-rose-500/20",
          onClick: () => setLocation("/admin/users"),
        },
        {
          label: "عدد الأدمن",
          value: stats.totalAdmins,
          icon: <Shield size={22} />,
          color: "text-indigo-400",
          bg: "bg-indigo-500/10",
          border: "border-indigo-500/20",
          onClick: () => setLocation("/admin/users"),
        },
      ]
    : [];

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
        <>
          <p className="text-sm text-gray-400 mb-5">
            نظرة عامة على المنصة — انقر أي بطاقة للانتقال
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card) => (
              <div
                key={card.label}
                onClick={card.onClick}
                className={`border ${card.border} ${card.bg} rounded-xl p-5 flex flex-col gap-3 ${card.onClick ? "cursor-pointer hover:brightness-110 transition-all" : ""}`}
              >
                <div className={card.color}>{card.icon}</div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {card.value.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 font-medium leading-tight" dir="rtl">
                    {card.label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {stats && stats.totalUsers === 0 && stats.totalAuctions === 0 && (
            <div className="text-center py-16 text-gray-500 mt-8">
              <Gavel size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا بيانات بعد — المنصة جاهزة للاستخدام.</p>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}
