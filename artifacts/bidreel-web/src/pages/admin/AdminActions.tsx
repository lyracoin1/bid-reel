import { useEffect, useState } from "react";
import { Loader2, AlertCircle, History, Shield, Gavel, Flag } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { adminGetActions, type AdminAction } from "@/lib/admin-api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ban_user:        { label: "حظر مستخدم",     color: "text-red-400",      bg: "bg-red-500/15",      border: "border-red-500/30" },
  unban_user:      { label: "رفع الحظر",       color: "text-emerald-400",  bg: "bg-emerald-500/15",  border: "border-emerald-500/30" },
  remove_auction:  { label: "إزالة مزاد",      color: "text-amber-400",    bg: "bg-amber-500/15",    border: "border-amber-500/30" },
  dismiss_report:  { label: "رفض بلاغ",        color: "text-gray-400",     bg: "bg-gray-500/15",     border: "border-gray-500/30" },
  resolve_report:  { label: "حل بلاغ",         color: "text-blue-400",     bg: "bg-blue-500/15",     border: "border-blue-500/30" },
  promote_admin:   { label: "ترقية أدمن",      color: "text-violet-400",   bg: "bg-violet-500/15",   border: "border-violet-500/30" },
  demote_admin:    { label: "إزالة صلاحيات",   color: "text-orange-400",   bg: "bg-orange-500/15",   border: "border-orange-500/30" },
};

const TARGET_ICONS: Record<string, React.ReactNode> = {
  user:    <Shield size={13} />,
  auction: <Gavel size={13} />,
  report:  <Flag size={13} />,
};

export default function AdminActions() {
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGetActions()
      .then(setActions)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminLayout title="سجل الإجراءات">
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="text-violet-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
          <AlertCircle size={18} /><span className="text-sm">{error}</span>
        </div>
      ) : actions.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <History size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">لا توجد إجراءات مسجّلة بعد</p>
          <p className="text-xs text-gray-600 mt-1">
            يظهر هنا كل إجراء يتخذه الأدمن (حظر، إزالة مزاد، حل بلاغ…)
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {actions.map(a => {
            const meta = ACTION_LABELS[a.actionType] ?? {
              label: a.actionType,
              color: "text-gray-300",
              bg: "bg-gray-700/30",
              border: "border-gray-700/50",
            };

            return (
              <div
                key={a.id}
                className="flex items-start gap-4 bg-gray-900 border border-gray-800 rounded-xl px-5 py-4"
              >
                {/* Action badge */}
                <div className={`shrink-0 mt-0.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${meta.color} ${meta.bg} ${meta.border}`}>
                  {meta.label}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium">
                      {a.admin?.displayName ?? a.admin?.phone ?? a.admin?.id.slice(0, 8) ?? "—"}
                    </span>
                    <span className="text-xs text-gray-500">→</span>
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      {TARGET_ICONS[a.targetType] ?? null}
                      {a.targetType}
                    </span>
                    <span className="font-mono text-xs text-gray-500">{String(a.targetId).slice(0, 8)}…</span>
                  </div>
                  {a.note && (
                    <p className="text-xs text-gray-500 mt-1 truncate">{a.note}</p>
                  )}
                </div>

                {/* Timestamp */}
                <div className="shrink-0 text-xs text-gray-600 whitespace-nowrap">
                  {formatDate(a.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}
