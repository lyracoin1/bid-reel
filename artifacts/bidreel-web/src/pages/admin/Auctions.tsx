import { useEffect, useState } from "react";
import {
  Loader2, AlertCircle, Gavel, MoreHorizontal, EyeOff, Trash2, CheckCircle,
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

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPrice(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STATUS_STYLES: Record<string, string> = {
  active:  "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
  ended:   "bg-gray-600/20 text-gray-400 border-gray-600/30",
  removed: "bg-red-600/20 text-red-400 border-red-600/30",
};

export default function AdminAuctions() {
  const [auctions, setAuctions] = useState<AdminAuction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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

  function runConfirm(action: ConfirmAction) {
    setOpenMenu(null);
    setConfirm(action);
  }

  async function handleConfirm() {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.onConfirm();
      showToast("Action completed");
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setConfirming(false);
      setConfirm(null);
    }
  }

  return (
    <AdminLayout title="Auctions">

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
                Cancel
              </button>
              <button onClick={handleConfirm} disabled={confirming}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${confirm.variant === "danger" ? "bg-red-600 hover:bg-red-500" : "bg-amber-600 hover:bg-amber-500"} disabled:opacity-50`}>
                {confirming && <Loader2 size={14} className="animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
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
      ) : auctions.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Gavel size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No auctions yet</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Title</th>
                <th className="text-left px-4 py-3 font-semibold">Seller</th>
                <th className="text-left px-4 py-3 font-semibold">Current Bid</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Created</th>
                <th className="text-left px-4 py-3 font-semibold">Ends</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {auctions.map(a => (
                <tr key={a.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-white max-w-[200px] truncate">{a.title}</div>
                    <div className="text-xs text-gray-500">{a.category} · {a.bidCount} bids</div>
                  </td>
                  <td className="px-4 py-3.5 text-gray-300 text-xs">{a.seller?.displayName ?? "—"}</td>
                  <td className="px-4 py-3.5 text-white font-semibold">{formatPrice(a.currentBid)}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[a.status] ?? "bg-gray-700 text-gray-300"}`}>
                      {a.status}
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
                        <div className="absolute right-0 top-8 z-20 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
                          {a.status !== "removed" ? (
                            <button onClick={() => runConfirm({
                              label: "Hide Auction",
                              description: "This will remove the auction from the public feed.",
                              variant: "warning",
                              onConfirm: async () => {
                                await adminUpdateAuction(a.id, { status: "removed" });
                                setAuctions(prev => prev.map(x => x.id === a.id ? { ...x, status: "removed" } : x));
                              },
                            })}
                              className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2">
                              <EyeOff size={14} className="text-amber-400" /> Hide Auction
                            </button>
                          ) : (
                            <button onClick={async () => {
                              setOpenMenu(null);
                              try {
                                await adminUpdateAuction(a.id, { status: "active" });
                                setAuctions(prev => prev.map(x => x.id === a.id ? { ...x, status: "active" } : x));
                                showToast("Auction restored");
                              } catch (err) { showToast((err as Error).message, false); }
                            }}
                              className="w-full text-left px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2">
                              <CheckCircle size={14} /> Restore Auction
                            </button>
                          )}
                          <button onClick={() => runConfirm({
                            label: "Delete Auction",
                            description: "This permanently deletes the auction and all its bids. This cannot be undone.",
                            variant: "danger",
                            onConfirm: async () => {
                              await adminDeleteAuction(a.id);
                              setAuctions(prev => prev.filter(x => x.id !== a.id));
                            },
                          })}
                            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2">
                            <Trash2 size={14} /> Delete
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
