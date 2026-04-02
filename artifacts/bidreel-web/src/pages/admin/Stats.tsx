import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Users, Gavel, Activity, Wallet, Flag } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { adminGetStats, type AdminStats } from "@/lib/admin-api";

interface Metric {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  description: string;
}

export default function AdminStats() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGetStats()
      .then(setStats)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const metrics: Metric[] = stats
    ? [
        {
          label: "Total Users",
          value: stats.totalUsers,
          icon: <Users size={24} />,
          color: "text-blue-400",
          bg: "bg-blue-500/8",
          border: "border-blue-500/20",
          description: "Registered accounts on the platform",
        },
        {
          label: "Total Auctions",
          value: stats.totalAuctions,
          icon: <Gavel size={24} />,
          color: "text-violet-400",
          bg: "bg-violet-500/8",
          border: "border-violet-500/20",
          description: "All auctions ever created",
        },
        {
          label: "Active Auctions",
          value: stats.activeAuctions,
          icon: <Activity size={24} />,
          color: "text-emerald-400",
          bg: "bg-emerald-500/8",
          border: "border-emerald-500/20",
          description: "Currently live auctions accepting bids",
        },
        {
          label: "Total Bids",
          value: stats.totalBids,
          icon: <Wallet size={24} />,
          color: "text-amber-400",
          bg: "bg-amber-500/8",
          border: "border-amber-500/20",
          description: "Cumulative bids placed across all auctions",
        },
        {
          label: "Pending Reports",
          value: stats.openReports,
          icon: <Flag size={24} />,
          color: "text-red-400",
          bg: "bg-red-500/8",
          border: "border-red-500/20",
          description: "Reports awaiting moderation review",
        },
      ]
    : [];

  return (
    <AdminLayout title="Platform Stats">
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="text-violet-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
          <AlertCircle size={18} /><span className="text-sm">{error}</span>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-400 mb-6">Real-time metrics pulled directly from the database.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {metrics.map((m) => (
              <div
                key={m.label}
                className={`border ${m.border} ${m.bg} rounded-xl p-6 flex flex-col gap-4`}
              >
                <div className={`${m.color} opacity-80`}>{m.icon}</div>
                <div>
                  <div className={`text-3xl font-bold ${m.color}`}>
                    {m.value.toLocaleString()}
                  </div>
                  <div className="text-sm font-semibold text-white mt-1">{m.label}</div>
                  <div className="text-xs text-gray-500 mt-1">{m.description}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
