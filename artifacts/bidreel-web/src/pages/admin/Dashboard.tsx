import { useEffect, useState } from "react";
import { Users, Gavel, Activity, Flag, Loader2, AlertCircle } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { adminGetStats, type AdminStats } from "@/lib/admin-api";

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGetStats()
      .then(setStats)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const cards: StatCard[] = stats
    ? [
        {
          label: "Total Users",
          value: stats.totalUsers,
          icon: <Users size={22} />,
          color: "text-blue-400",
          bg: "bg-blue-500/10 border-blue-500/20",
        },
        {
          label: "Total Auctions",
          value: stats.totalAuctions,
          icon: <Gavel size={22} />,
          color: "text-violet-400",
          bg: "bg-violet-500/10 border-violet-500/20",
        },
        {
          label: "Active Auctions",
          value: stats.activeAuctions,
          icon: <Activity size={22} />,
          color: "text-emerald-400",
          bg: "bg-emerald-500/10 border-emerald-500/20",
        },
        {
          label: "Open Reports",
          value: stats.openReports,
          icon: <Flag size={22} />,
          color: "text-red-400",
          bg: "bg-red-500/10 border-red-500/20",
        },
      ]
    : [];

  return (
    <AdminLayout title="Dashboard">
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {cards.map((card) => (
              <div
                key={card.label}
                className={`border rounded-xl p-5 flex flex-col gap-3 ${card.bg}`}
              >
                <div className={`${card.color}`}>{card.icon}</div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {card.value.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 font-medium">{card.label}</div>
                </div>
              </div>
            ))}
          </div>

          {stats && stats.totalUsers === 0 && stats.totalAuctions === 0 && (
            <div className="text-center py-16 text-gray-500">
              <Gavel size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No data yet — the platform is ready for real usage.</p>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}
