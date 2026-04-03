import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Users, Gavel, Activity, Wallet, Flag, EyeOff, TrendingDown, Shield, Ban, CheckCircle, XCircle } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { adminGetStats, type AdminStats } from "@/lib/admin-api";

interface Metric {
  group: string;
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
          group: "المستخدمون",
          label: "إجمالي المستخدمين",
          value: stats.totalUsers,
          icon: <Users size={22} />,
          color: "text-blue-400",
          bg: "bg-blue-500/8",
          border: "border-blue-500/20",
          description: "جميع الحسابات المسجّلة في المنصة",
        },
        {
          group: "المستخدمون",
          label: "عدد الأدمن",
          value: stats.totalAdmins,
          icon: <Shield size={22} />,
          color: "text-indigo-400",
          bg: "bg-indigo-500/8",
          border: "border-indigo-500/20",
          description: "المستخدمون الذين يملكون صلاحيات الإدارة",
        },
        {
          group: "المستخدمون",
          label: "المستخدمون المحظورون",
          value: stats.bannedUsers,
          icon: <Ban size={22} />,
          color: "text-rose-400",
          bg: "bg-rose-500/8",
          border: "border-rose-500/20",
          description: "حسابات محظورة من الوصول إلى المنصة",
        },
        {
          group: "المزادات",
          label: "إجمالي المزادات",
          value: stats.totalAuctions,
          icon: <Gavel size={22} />,
          color: "text-violet-400",
          bg: "bg-violet-500/8",
          border: "border-violet-500/20",
          description: "جميع المزادات التي أُنشئت على المنصة",
        },
        {
          group: "المزادات",
          label: "المزادات النشطة",
          value: stats.activeAuctions,
          icon: <Activity size={22} />,
          color: "text-emerald-400",
          bg: "bg-emerald-500/8",
          border: "border-emerald-500/20",
          description: "مزادات مفتوحة حالياً وتقبل عروضاً",
        },
        {
          group: "المزادات",
          label: "المزادات المنتهية",
          value: stats.endedAuctions,
          icon: <TrendingDown size={22} />,
          color: "text-gray-400",
          bg: "bg-gray-500/8",
          border: "border-gray-500/20",
          description: "مزادات انتهت مدتها بشكل طبيعي",
        },
        {
          group: "المزادات",
          label: "المزادات المحذوفة",
          value: stats.removedAuctions,
          icon: <EyeOff size={22} />,
          color: "text-orange-400",
          bg: "bg-orange-500/8",
          border: "border-orange-500/20",
          description: "مزادات أُخفيت بواسطة البائع أو الأدمن",
        },
        {
          group: "المزادات",
          label: "إجمالي المزايدات",
          value: stats.totalBids,
          icon: <Wallet size={22} />,
          color: "text-amber-400",
          bg: "bg-amber-500/8",
          border: "border-amber-500/20",
          description: "مجموع العروض المُقدَّمة عبر جميع المزادات",
        },
        {
          group: "البلاغات",
          label: "إجمالي البلاغات",
          value: stats.totalReports,
          icon: <Flag size={22} />,
          color: "text-gray-400",
          bg: "bg-gray-500/8",
          border: "border-gray-500/20",
          description: "جميع البلاغات المُرسَلة من المستخدمين",
        },
        {
          group: "البلاغات",
          label: "البلاغات المعلّقة",
          value: stats.openReports,
          icon: <Flag size={22} />,
          color: "text-red-400",
          bg: "bg-red-500/8",
          border: "border-red-500/20",
          description: "بلاغات في انتظار مراجعة الأدمن",
        },
        {
          group: "البلاغات",
          label: "البلاغات المحلولة",
          value: stats.resolvedReports,
          icon: <CheckCircle size={22} />,
          color: "text-emerald-400",
          bg: "bg-emerald-500/8",
          border: "border-emerald-500/20",
          description: "بلاغات تمت معالجتها باتخاذ إجراء",
        },
        {
          group: "البلاغات",
          label: "البلاغات المرفوضة",
          value: stats.dismissedReports,
          icon: <XCircle size={22} />,
          color: "text-gray-400",
          bg: "bg-gray-500/8",
          border: "border-gray-500/20",
          description: "بلاغات تمت مراجعتها وإغلاقها دون اتخاذ إجراء",
        },
      ]
    : [];

  const groups = [...new Set(metrics.map(m => m.group))];

  return (
    <AdminLayout title="الإحصائيات">
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="text-violet-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
          <AlertCircle size={18} /><span className="text-sm">{error}</span>
        </div>
      ) : (
        <div className="space-y-8">
          <p className="text-xs text-gray-500 -mt-2">
            جميع المقاييس مسحوبة مباشرةً من قاعدة البيانات
          </p>
          {groups.map(group => (
            <section key={group}>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4" dir="rtl">{group}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {metrics.filter(m => m.group === group).map((m) => (
                  <div
                    key={m.label}
                    className={`border ${m.border} ${m.bg} rounded-xl p-5 flex flex-col gap-3`}
                  >
                    <div className={`${m.color} opacity-80`}>{m.icon}</div>
                    <div>
                      <div className={`text-3xl font-bold ${m.color}`}>
                        {m.value.toLocaleString()}
                      </div>
                      <div className="text-sm font-semibold text-white mt-1" dir="rtl">{m.label}</div>
                      <div className="text-xs text-gray-500 mt-1" dir="rtl">{m.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
