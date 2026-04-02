import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Shield, User, Ban, MoreHorizontal, CheckCircle } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import {
  adminGetUsers, adminUpdateUser, type AdminUser,
} from "@/lib/admin-api";
import { UserAvatar } from "@/components/ui/user-avatar";

interface ConfirmAction {
  label: string;
  description: string;
  variant: "danger" | "warning";
  onConfirm: () => Promise<void>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
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
    adminGetUsers()
      .then(setUsers)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function applyUpdate(id: string, patch: Parameters<typeof adminUpdateUser>[1]) {
    const updated = await adminUpdateUser(id, patch);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updated } : u));
  }

  function runConfirm(action: ConfirmAction) {
    setOpenMenu(null);
    setConfirm(action);
  }

  async function handleConfirm() {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.onConfirm();
      showToast("Action completed successfully");
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setConfirming(false);
      setConfirm(null);
    }
  }

  return (
    <AdminLayout title="Users">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* Confirm dialog */}
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
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <User size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No users yet</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">User</th>
                <th className="text-left px-4 py-3 font-semibold">Phone</th>
                <th className="text-left px-4 py-3 font-semibold">Role</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <UserAvatar src={u.avatarUrl ?? null} name={u.displayName ?? u.phone ?? "?"} size={32} className="rounded-lg shrink-0" />
                      <div>
                        <div className="font-medium text-white">{u.displayName ?? "—"}</div>
                        <div className="text-xs text-gray-500 font-mono">{u.id.slice(0, 8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-gray-300 font-mono text-xs">{u.phone ?? "—"}</td>
                  <td className="px-4 py-3.5">
                    {u.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-600/20 text-violet-300 text-xs font-semibold border border-violet-600/30">
                        <Shield size={10} /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-xs font-medium">
                        <User size={10} /> User
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.isBanned ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600/20 text-red-400 text-xs font-semibold border border-red-600/30">
                        <Ban size={10} /> Banned
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 text-xs font-medium border border-emerald-600/30">
                        <CheckCircle size={10} /> Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3.5">
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === u.id ? null : u.id)}
                        className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === u.id && (
                        <div className="absolute right-0 top-8 z-20 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
                          {u.role !== "admin" ? (
                            <button onClick={() => runConfirm({
                              label: "Promote to Admin",
                              description: `Grant admin access to this user?`,
                              variant: "warning",
                              onConfirm: () => applyUpdate(u.id, { role: "admin" }),
                            })}
                              className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2">
                              <Shield size={14} className="text-violet-400" /> Promote to Admin
                            </button>
                          ) : (
                            <button onClick={() => runConfirm({
                              label: "Demote to User",
                              description: `Remove admin access from this user?`,
                              variant: "danger",
                              onConfirm: () => applyUpdate(u.id, { role: "user" }),
                            })}
                              className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2">
                              <User size={14} className="text-amber-400" /> Demote to User
                            </button>
                          )}
                          {!u.isBanned ? (
                            <button onClick={() => runConfirm({
                              label: "Ban User",
                              description: `This will block the user from the platform.`,
                              variant: "danger",
                              onConfirm: () => applyUpdate(u.id, { isBanned: true }),
                            })}
                              className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2">
                              <Ban size={14} /> Ban User
                            </button>
                          ) : (
                            <button onClick={async () => {
                              setOpenMenu(null);
                              try {
                                await applyUpdate(u.id, { isBanned: false });
                                showToast("User unbanned");
                              } catch (err) { showToast((err as Error).message, false); }
                            }}
                              className="w-full text-left px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2">
                              <CheckCircle size={14} /> Unban User
                            </button>
                          )}
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
