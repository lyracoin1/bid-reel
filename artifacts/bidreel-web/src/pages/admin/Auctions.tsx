import { useEffect, useState, useMemo } from "react";
import {
  Loader2, AlertCircle, Gavel, MoreHorizontal, EyeOff, Trash2, CheckCircle, Search, X,
} from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import {
  adminGetAuctions, adminUpdateAuction, adminDeleteAuction, type AdminAuction,
} from "@/lib/admin-api";

interface ConfirmAction {
  label: string;
  description: string;
  variant: "danger" | "warning";
  onConfirm: () => Promise<void>;
}

type StatusFilter = "all" | "active" | "ended" | "removed";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPrice(n: number, currencyCode = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currencyCode} ${n.toLocaleString("en-US")}`;
  }
}

const STATUS_STYLES: Record<string, string> = {
  active:  "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
  ended:   "bg-gray-600/20 text-gray-400 border-gray-600/30",
  removed: "bg-red-600/20 text-red-400 border-red-600/30",
};

const STATUS_LABELS: Record<string, string> = {
  active:  "نشط",
  ended:   "منتهي",
  removed: "محذوف",
};

export default function AdminAuctions() {
  const [auctions, setAuctions] = useState<AdminAuction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    adminGetAuctions()
      .then(setAuctions)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auctions.filter(a => {
      if (q) {
        const titleMatch = a.title.toLowerCase().includes(q);
        const sellerMatch = (a.seller?.displayName ?? "").toLowerCase().includes(q);
        const categoryMatch = (a.category ?? "").toLowerCase().includes(q);
        if (!titleMatch && !sellerMatch && !categoryMatch) return false;
      }
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    });
  }, [auctions, search, statusFilter]);

  function runConfirm(action: ConfirmAction) {
    setOpenMenu(null);
    setConfirm(action);
  }

  async function handleConfirm() {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.onConfirm();
      showToast("تم تنفيذ الإجراء");
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setConfirming(false);
      setConfirm(null);
    }
  }

  const hasFilters = search.trim() || statusFilter !== "all";

  return (
    <AdminLayout title="المزادات">

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2">{confirm.label}</h3>
            <p className="text-sm text-gray-400 mb-6">{confirm.description}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors">
                إلغاء
              </button>
              <button onClick={handleConfirm} disabled={confirming}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${confirm.variant === "danger" ? "bg-red-600 hover:bg-red-500" : "bg-amber-600 hover:bg-amber-500"} disabled:opacity-50`}>
                {confirming && <Loader2 size={14} className="animate-spin" />}
                تأكيد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search + Filters */}
      {!loading && !error && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بعنوان المزاد أو البائع…"
              dir="rtl"
              className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 transition"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                <X size={14} />
              </button>
            )}
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500 transition"
            dir="rtl"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="ended">منتهي</option>
            <option value="removed">محذوف</option>
          </select>

          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); }}
              className="text-xs text-gray-500 hover:text-white transition flex items-center gap-1"
            >
              <X size={12} /> إلغاء الفلاتر
            </button>
          )}

          <span className="text-xs text-gray-500 mr-auto">{filtered.length} مزاد</span>
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
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Gavel size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{auctions.length === 0 ? "لا مزادات بعد" : "لا نتائج تطابق البحث"}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">العنوان</th>
                <th className="text-left px-4 py-3 font-semibold">البائع</th>
                <th className="text-left px-4 py-3 font-semibold">أعلى مزايدة</th>
                <th className="text-left px-4 py-3 font-semibold">الحالة</th>
                <th className="text-left px-4 py-3 font-semibold">تاريخ الإنشاء</th>
                <th className="text-left px-4 py-3 font-semibold">ينتهي</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(a => (
                <tr key={a.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-white max-w-[200px] truncate">{a.title}</div>
                    <div className="text-xs text-gray-500">{a.category} · {a.bidCount} مزايدة</div>
                  </td>
                  <td className="px-4 py-3.5 text-gray-300 text-xs">{a.seller?.displayName ?? "—"}</td>
                  <td className="px-4 py-3.5 text-white font-semibold">{formatPrice(a.currentBid, a.currencyCode)}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[a.status] ?? "bg-gray-700 text-gray-300"}`}>
                      {STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(a.createdAt)}</td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(a.endsAt)}</td>
                  <td className="px-4 py-3.5">
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === a.id ? null : a.id)}
                        className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === a.id && (
                        <div className="absolute right-0 top-8 z-20 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden" dir="rtl">
                          {a.status !== "removed" ? (
                            <button onClick={() => runConfirm({
                              label: "إخفاء المزاد",
                              description: "سيتم إزالة المزاد من الفيد العام.",
                              variant: "warning",
                              onConfirm: async () => {
                                await adminUpdateAuction(a.id, { status: "removed" });
                                setAuctions(prev => prev.map(x => x.id === a.id ? { ...x, status: "removed" } : x));
                              },
                            })}
                              className="w-full text-right px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2">
                              <EyeOff size={14} className="text-amber-400" /> إخفاء المزاد
                            </button>
                          ) : (
                            <button onClick={async () => {
                              setOpenMenu(null);
                              try {
                                await adminUpdateAuction(a.id, { status: "active" });
                                setAuctions(prev => prev.map(x => x.id === a.id ? { ...x, status: "active" } : x));
                                showToast("تم استعادة المزاد");
                              } catch (err) { showToast((err as Error).message, false); }
                            }}
                              className="w-full text-right px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2">
                              <CheckCircle size={14} /> استعادة المزاد
                            </button>
                          )}
                          <button onClick={() => runConfirm({
                            label: "حذف المزاد نهائياً",
                            description: "سيتم حذف المزاد وجميع مزايداته بشكل دائم. لا يمكن التراجع.",
                            variant: "danger",
                            onConfirm: async () => {
                              await adminDeleteAuction(a.id);
                              setAuctions(prev => prev.filter(x => x.id !== a.id));
                            },
                          })}
                            className="w-full text-right px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2">
                            <Trash2 size={14} /> حذف نهائي
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
