import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, AlertCircle, Shield, User, Ban, MoreHorizontal,
  CheckCircle, Search, X, AlertTriangle, Trash2,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminGetUsers, adminUpdateUser, adminDeleteUser, type AdminUser } from "@/services/admin-api";
import { UserAvatar } from "@/components/ui/user-avatar";
import { supabase } from "@/lib/supabase";

interface ConfirmAction {
  label: string;
  description: string;
  variant: "danger" | "warning";
  onConfirm: () => Promise<void>;
}

type RoleFilter   = "all" | "admin" | "user";
type StatusFilter = "all" | "active" | "banned" | "incomplete";

type MenuAnchor = {
  top?: number;
  bottom?: number;
  left: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Users() {
  const [users, setUsers]           = useState<AdminUser[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirm, setConfirm]       = useState<ConfirmAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [openMenu, setOpenMenu]     = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setCurrentAdminId(session.user.id);
    });
  }, []);

  useEffect(() => {
    adminGetUsers()
      .then(setUsers)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setMenuAnchor(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [openMenu]);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  function openMenuAtButton(userId: string, e: React.MouseEvent<HTMLButtonElement>) {
    if (openMenu === userId) {
      setOpenMenu(null);
      setMenuAnchor(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 208; // w-52
    const menuHeight = 145;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < menuHeight + 8;
    // Clamp left so menu stays within viewport
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    setOpenMenu(userId);
    setMenuAnchor(
      openUpward
        ? { bottom: window.innerHeight - rect.top + 4, left }
        : { top: rect.bottom + 4, left },
    );
  }

  function closeMenu() {
    setOpenMenu(null);
    setMenuAnchor(null);
  }

  const incompleteCount = useMemo(() => users.filter(u => !u.isCompleted).length, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (q) {
        const nameMatch  = (u.displayName ?? "").toLowerCase().includes(q);
        const phoneMatch = (u.phone ?? "").includes(q);
        const idMatch    = u.id.toLowerCase().includes(q);
        const userMatch  = (u.username ?? "").toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !idMatch && !userMatch) return false;
      }
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active"     && (u.isBanned || !u.isCompleted)) return false;
      if (statusFilter === "banned"     && !u.isBanned)   return false;
      if (statusFilter === "incomplete" &&  u.isCompleted) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  async function applyUpdate(id: string, patch: Parameters<typeof adminUpdateUser>[1]) {
    const updated = await adminUpdateUser(id, patch);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updated } : u));
  }

  function runConfirm(action: ConfirmAction) {
    closeMenu();
    setConfirm(action);
  }

  async function handleConfirm() {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.onConfirm();
      showToast("تم تنفيذ الإجراء بنجاح");
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setConfirming(false);
      setConfirm(null);
    }
  }

  const hasFilters = search.trim() || roleFilter !== "all" || statusFilter !== "all";

  const openMenuUser = openMenu ? users.find(u => u.id === openMenu) ?? null : null;

  return (
    <AdminLayout title="المستخدمون">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
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

      {!loading && !error && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو رقم الهاتف…"
              dir="rtl"
              className="w-full pl-9 pr-4 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 transition"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                <X size={14} />
              </button>
            )}
          </div>

          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as RoleFilter)}
            className="px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500 transition" dir="rtl">
            <option value="all">كل الأدوار</option>
            <option value="admin">أدمن فقط</option>
            <option value="user">مستخدمون فقط</option>
          </select>

          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500 transition" dir="rtl">
            <option value="all">كل الحالات</option>
            <option value="active">مكتمل ونشط</option>
            <option value="incomplete">غير مكتمل ({incompleteCount})</option>
            <option value="banned">محظور</option>
          </select>

          {hasFilters && (
            <button onClick={() => { setSearch(""); setRoleFilter("all"); setStatusFilter("all"); }}
              className="text-xs text-gray-500 hover:text-white transition flex items-center gap-1">
              <X size={12} /> إلغاء الفلاتر
            </button>
          )}

          <span className="text-xs text-gray-500 ml-auto">{filtered.length} مستخدم</span>
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
          <User size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{users.length === 0 ? "لا مستخدمين بعد" : "لا نتائج تطابق البحث"}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">المستخدم</th>
                <th className="text-left px-4 py-3 font-semibold">الهاتف</th>
                <th className="text-left px-4 py-3 font-semibold">الدور</th>
                <th className="text-left px-4 py-3 font-semibold">الحالة</th>
                <th className="text-left px-4 py-3 font-semibold">الاكتمال</th>
                <th className="text-left px-4 py-3 font-semibold">تاريخ الإنشاء</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(u => (
                <tr key={u.id} className={`hover:bg-gray-800/50 transition-colors ${!u.isCompleted ? "bg-amber-950/10" : ""}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <UserAvatar src={u.avatarUrl} name={u.displayName ?? u.phone ?? "?"} size={32} className="rounded-lg shrink-0" />
                      <div>
                        <div className="font-medium text-white">{u.displayName ?? <span className="text-gray-600 italic">بدون اسم</span>}</div>
                        <div className="text-xs text-gray-500">
                          {u.username ? <span className="text-gray-400">@{u.username}</span> : <span className="text-gray-700 italic">بدون معرّف</span>}
                          <span className="mx-1 text-gray-700">·</span>
                          <span className="font-mono">{u.id.slice(0, 8)}…</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-gray-300 font-mono text-xs">{u.phone ?? <span className="text-gray-700 italic">—</span>}</td>
                  <td className="px-4 py-3.5">
                    {u.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-600/20 text-violet-300 text-xs font-semibold border border-violet-600/30">
                        <Shield size={10} /> أدمن
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-xs font-medium">
                        <User size={10} /> مستخدم
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.isBanned ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600/20 text-red-400 text-xs font-semibold border border-red-600/30">
                        <Ban size={10} /> محظور
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 text-xs font-medium border border-emerald-600/30">
                        <CheckCircle size={10} /> نشط
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600/10 text-emerald-500 text-xs font-medium border border-emerald-600/20">
                        <CheckCircle size={10} /> مكتمل
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 text-xs font-semibold border border-amber-600/30">
                          <AlertTriangle size={10} /> غير مكتمل
                        </span>
                        {u.missingFields.length > 0 && (
                          <span className="text-[10px] text-gray-600 leading-tight">
                            ناقص: {u.missingFields.join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={e => openMenuAtButton(u.id, e)}
                      className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openMenu && menuAnchor && openMenuUser && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top:    menuAnchor.top,
            bottom: menuAnchor.bottom,
            left:   menuAnchor.left,
            zIndex: 9999,
          }}
          className="w-52 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
          dir="rtl"
        >
          {openMenuUser.role !== "admin" ? (
            <button
              onClick={() => runConfirm({
                label: "ترقية إلى أدمن",
                description: "هل تريد منح صلاحيات الأدمن لهذا المستخدم؟",
                variant: "warning",
                onConfirm: () => applyUpdate(openMenuUser.id, { role: "admin" }),
              })}
              className="w-full text-right px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
            >
              <Shield size={14} className="text-violet-400" /> ترقية إلى أدمن
            </button>
          ) : (
            <button
              onClick={() => runConfirm({
                label: "تخفيض الدور إلى مستخدم",
                description: "هل تريد إزالة صلاحيات الأدمن من هذا المستخدم؟",
                variant: "danger",
                onConfirm: () => applyUpdate(openMenuUser.id, { role: "user" }),
              })}
              className="w-full text-right px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
            >
              <User size={14} className="text-amber-400" /> إزالة الأدمن
            </button>
          )}

          {!openMenuUser.isBanned ? (
            <button
              onClick={() => runConfirm({
                label: "حظر المستخدم",
                description: "سيتم منع هذا المستخدم من الوصول إلى المنصة.",
                variant: "danger",
                onConfirm: () => applyUpdate(openMenuUser.id, { isBanned: true }),
              })}
              className="w-full text-right px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
            >
              <Ban size={14} /> حظر المستخدم
            </button>
          ) : (
            <button
              onClick={async () => {
                closeMenu();
                try {
                  await applyUpdate(openMenuUser.id, { isBanned: false });
                  showToast("تم رفع الحظر عن المستخدم");
                } catch (err) {
                  showToast((err as Error).message, false);
                }
              }}
              className="w-full text-right px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2"
            >
              <CheckCircle size={14} /> رفع الحظر
            </button>
          )}

          {currentAdminId !== openMenuUser.id && (
            <>
              <div className="border-t border-gray-700 mx-3 my-1" />
              <button
                onClick={() => runConfirm({
                  label: "حذف المستخدم نهائياً",
                  description: `سيتم حذف حساب "${openMenuUser.displayName ?? openMenuUser.username ?? openMenuUser.id.slice(0, 8)}" وجميع بياناته (مزاداته، مزايداته، متابعاته) بشكل لا رجعة فيه. هذا الإجراء لا يمكن التراجع عنه.`,
                  variant: "danger",
                  onConfirm: async () => {
                    await adminDeleteUser(openMenuUser.id);
                    setUsers(prev => prev.filter(u => u.id !== openMenuUser.id));
                  },
                })}
                className="w-full text-right px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2 font-semibold"
              >
                <Trash2 size={14} /> حذف المستخدم نهائياً
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </AdminLayout>
  );
}
