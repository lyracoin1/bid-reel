import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Flag, CheckCircle, MoreHorizontal, XCircle, ShieldAlert } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { adminGetReports, adminUpdateReport, type AdminReport } from "@/lib/admin-api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const REASON_LABELS: Record<string, string> = {
  spam_or_fake:       "Spam / Fake",
  offensive_content:  "Offensive Content",
  prohibited_item:    "Prohibited Item",
  other:              "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-amber-600/20 text-amber-400 border-amber-600/30",
  reviewed:  "bg-blue-600/20 text-blue-400 border-blue-600/30",
  dismissed: "bg-gray-600/20 text-gray-400 border-gray-600/30",
  actioned:  "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
};

type ReportStatus = "pending" | "reviewed" | "dismissed" | "actioned";

export default function AdminReports() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

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

  async function updateStatus(id: string, status: ReportStatus) {
    setOpenMenu(null);
    setUpdating(id);
    try {
      await adminUpdateReport(id, status);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      showToast(`Report marked as ${status}`);
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <AdminLayout title="Reports">

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="text-violet-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
          <AlertCircle size={18} /><span className="text-sm">{error}</span>
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Flag size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No reports yet</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Reason</th>
                <th className="text-left px-4 py-3 font-semibold">Reporter</th>
                <th className="text-left px-4 py-3 font-semibold">Auction</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {reports.map(r => (
                <tr key={r.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-white">{REASON_LABELS[r.reason] ?? r.reason}</div>
                    {r.details && (
                      <div className="text-xs text-gray-400 mt-0.5 max-w-[200px] truncate">{r.details}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-gray-300 text-xs">
                    {r.reporter?.displayName ?? r.reporter?.id.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-gray-300 text-xs max-w-[160px] truncate">
                    {r.auction?.title ?? "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[r.status] ?? "bg-gray-700 text-gray-300"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3.5">
                    <div className="relative">
                      {updating === r.id ? (
                        <Loader2 size={16} className="text-violet-400 animate-spin" />
                      ) : (
                        <button
                          onClick={() => setOpenMenu(openMenu === r.id ? null : r.id)}
                          className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      )}
                      {openMenu === r.id && (
                        <div className="absolute right-0 top-8 z-20 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
                          <button onClick={() => updateStatus(r.id, "reviewed")}
                            className="w-full text-left px-4 py-2.5 text-sm text-blue-400 hover:bg-gray-700 flex items-center gap-2">
                            <CheckCircle size={14} /> Mark Reviewed
                          </button>
                          <button onClick={() => updateStatus(r.id, "dismissed")}
                            className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                            <XCircle size={14} className="text-gray-400" /> Dismiss
                          </button>
                          <button onClick={() => updateStatus(r.id, "actioned")}
                            className="w-full text-left px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2">
                            <ShieldAlert size={14} /> Take Action
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
