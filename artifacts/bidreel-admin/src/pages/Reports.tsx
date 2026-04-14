import { useEffect, useState, useMemo } from "react";
import {
  Loader2, AlertCircle, Flag, CheckCircle, MoreHorizontal,
  XCircle, ShieldAlert, Clock, Filter,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminGetReports, adminUpdateReport, type AdminReport } from "@/services/admin-api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ar-EG", { month: "short", day: "numeric", year: "numeric" });
}

const REASON_LABELS: Record<string, string> = {
  spam_or_fake:        "محتوى مزيف أو مزعج",
  offensive_content:   "محتوى مسيء",
  prohibited_item:     "عنصر محظور",
  fraud_scam:          "احتيال أو نصب",
  misleading_listing:  "إعلان مضلل",
  other:               "أخرى",
};

const STATUS_META: Record<string, { label: string; style: string }> = {
  pending:   { label: "معلّق",       style: "bg-amber-600/20 text-amber-400 border-amber-600/30" },
  dismissed: { label: "مرفوض",      style: "bg-gray-600/20 text-gray-400 border-gray-600/30" },
  actioned:  { label: "تم الإجراء", style: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" },
};

type StatusFilter = "all" | "pending" | "dismissed" | "actioned";
type ReportStatus = "pending" | "dismissed" | "actioned";

export default function Reports() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    adminGetReports()
      .then(setReports)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return reports;
    return reports.filter(r => r.status === statusFilter);
  }, [reports, statusFilter]);

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = { all: reports.length, pending: 0, dismissed: 0, actioned: 0 };
    reports.forEach(r => { const s = r.status as StatusFilter; if (s in out) out[s]++; });
    return out;
  }, [reports]);

  async function updateStatus(id: string, status: ReportStatus) {
    setOpenMenu(null);
    setUpdating(id);
    try {
      await adminUpdateReport(id, status);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      showToast(`تم تحديث حالة البلاغ إلى: ${STATUS_META[status]?.label ?? status}`);
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setUpdating(null);
    }
  }

  const FILTER_TABS: { key: StatusFilter; label: string }[] = [
    { key: "all",       label: "الكل" },
    { key: "pending",   label: "معلّق" },
    { key: "actioned",  label: "تم الإجراء" },
    { key: "dismissed", label: "مرفوض" },
  ];

  return (
    <AdminLayout title="البلاغات">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {!loading && !error && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Filter size={14} className="text-gray-500 shrink-0" />
          {FILTER_TABS.map(tab => (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === tab.key ? "bg-violet-600/20 text-violet-300 border border-violet-600/30" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"}`}>
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${statusFilter === tab.key ? "bg-violet-500/30 text-violet-300" : "bg-gray-700 text-gray-400"}`}>
                {counts[tab.key]}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 size={28} className="text-violet-500 animate-spin" /></div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
          <AlertCircle size={18} /><span className="text-sm">{error}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Flag size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm" dir="rtl">{reports.length === 0 ? "لا توجد بلاغات بعد" : "لا توجد بلاغات تطابق هذه الفلترة"}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider" dir="rtl">
                <th className="text-right px-5 py-3 font-semibold">السبب</th>
                <th className="text-right px-4 py-3 font-semibold">المُبلِّغ</th>
                <th className="text-right px-4 py-3 font-semibold">المزاد</th>
                <th className="text-right px-4 py-3 font-semibold">الحالة</th>
                <th className="text-right px-4 py-3 font-semibold">التاريخ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(r => {
                const statusMeta = STATUS_META[r.status] ?? { label: r.status, style: "bg-gray-700 text-gray-300" };
                return (
                  <tr key={r.id} className="hover:bg-gray-800/50 transition-colors" dir="rtl">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-white">{REASON_LABELS[r.reason] ?? r.reason}</div>
                      {r.details && <div className="text-xs text-gray-400 mt-0.5 max-w-[220px] truncate">{r.details}</div>}
                      {r.adminNote && <div className="text-xs text-violet-400 mt-0.5 max-w-[220px] truncate">ملاحظة: {r.adminNote}</div>}
                    </td>
                    <td className="px-4 py-3.5 text-gray-300 text-xs">{r.reporter?.displayName ?? r.reporter?.id.slice(0, 8) ?? "—"}</td>
                    <td className="px-4 py-3.5 text-gray-300 text-xs max-w-[160px] truncate">{r.auction?.title ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${statusMeta.style}`}>
                        {r.status === "pending" && <Clock size={10} />}
                        {r.status === "actioned" && <CheckCircle size={10} />}
                        {r.status === "dismissed" && <XCircle size={10} />}
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <div className="relative">
                        {updating === r.id ? (
                          <Loader2 size={16} className="text-violet-400 animate-spin" />
                        ) : (
                          <button onClick={() => setOpenMenu(openMenu === r.id ? null : r.id)}
                            className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                            <MoreHorizontal size={16} />
                          </button>
                        )}
                        {openMenu === r.id && (
                          <div className="absolute left-0 top-8 z-20 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden" dir="rtl">
                            {r.status !== "actioned" && (
                              <button onClick={() => updateStatus(r.id, "actioned")}
                                className="w-full text-right px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2">
                                <ShieldAlert size={14} /> اتخاذ إجراء
                              </button>
                            )}
                            {r.status !== "dismissed" && (
                              <button onClick={() => updateStatus(r.id, "dismissed")}
                                className="w-full text-right px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                                <XCircle size={14} /> رفض البلاغ
                              </button>
                            )}
                            {r.status !== "pending" && (
                              <button onClick={() => updateStatus(r.id, "pending")}
                                className="w-full text-right px-4 py-2.5 text-sm text-amber-400 hover:bg-gray-700 flex items-center gap-2">
                                <Clock size={14} /> إعادة للمراجعة
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
