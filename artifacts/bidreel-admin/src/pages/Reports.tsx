import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, AlertCircle, Flag, CheckCircle, MoreHorizontal,
  XCircle, ShieldAlert, Clock, Filter, Eye, X,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminGetReports, adminUpdateReport, type AdminReport } from "@/services/admin-api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ar-EG", { month: "short", day: "numeric", year: "numeric" });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ar-EG", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
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

// ─── Portal-positioned action menu ────────────────────────────────────────────
// Rendered into document.body so the surrounding table's `overflow-hidden`
// can't clip it. Position is computed from the triggering button's bbox and
// flipped above the button when there isn't enough space below — fixes the
// "menu invisible at the bottom of the viewport" failure mode.
interface MenuPos { top: number; left: number; placement: "below" | "above" }

function ActionMenu({
  anchor, onClose, children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<MenuPos>(() => computePos(anchor));

  useEffect(() => {
    function reposition() { setPos(computePos(anchor)); }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor]);

  useEffect(() => {
    function onDocPointer(e: MouseEvent | TouchEvent) {
      const tgt = e.target as Node;
      if (menuRef.current?.contains(tgt)) return;
      if (anchor.contains(tgt)) return; // anchor toggle handles its own click
      onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("touchstart", onDocPointer, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("touchstart", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      dir="rtl"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
      }}
      className="w-52 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
    >
      {children}
    </div>,
    document.body,
  );
}

function computePos(anchor: HTMLElement): MenuPos {
  const rect = anchor.getBoundingClientRect();
  const MENU_W = 208;  // matches w-52
  const MENU_H = 200;  // upper bound — enough for 4 items
  const GAP = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Right-align the menu under the button (RTL UI). Clamp into the viewport
  // so it never falls off-screen.
  let left = rect.right - MENU_W;
  if (left < 8) left = 8;
  if (left + MENU_W > vw - 8) left = vw - MENU_W - 8;

  // Flip above the button when there isn't enough room below.
  const spaceBelow = vh - rect.bottom;
  const placement: "below" | "above" = spaceBelow < MENU_H + GAP ? "above" : "below";
  const top = placement === "below"
    ? rect.bottom + GAP
    : Math.max(8, rect.top - MENU_H - GAP);

  return { top, left, placement };
}

export default function Reports() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Selected report → drives the details modal.
  const [selectedReport, setSelectedReport] = useState<AdminReport | null>(null);
  // Open menu state: tracks both the report id and the anchor element so the
  // portal can position itself relative to the actual button — survives
  // table re-renders, scroll, resize.
  const [menuFor, setMenuFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);

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

  const updateStatus = useCallback(async (id: string, status: ReportStatus) => {
    setMenuFor(null);
    setUpdating(id);
    try {
      await adminUpdateReport(id, status);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      // Keep the details modal in sync if it's currently showing this report.
      setSelectedReport(prev => prev && prev.id === id ? { ...prev, status } : prev);
      showToast(`تم تحديث حالة البلاغ إلى: ${STATUS_META[status]?.label ?? status}`);
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setUpdating(null);
    }
  }, []);

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
        // NOTE: only `overflow-x-auto` here — the previous `overflow-hidden`
        // on the same element clipped the absolute-positioned action menu
        // and was the root cause of "the three-dots menu does nothing".
        // The action menu is now portaled into <body> regardless, but we
        // still drop the redundant overflow-hidden so any future inline
        // popovers won't silently disappear.
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
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
                  <tr
                    key={r.id}
                    dir="rtl"
                    onClick={() => setSelectedReport(r)}
                    className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                  >
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
                    {/* Action cell — stopPropagation prevents the row click
                        from hijacking the menu click and opening the modal. */}
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {updating === r.id ? (
                        <Loader2 size={16} className="text-violet-400 animate-spin" />
                      ) : (
                        <button
                          aria-haspopup="menu"
                          aria-expanded={menuFor?.id === r.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const btn = e.currentTarget;
                            setMenuFor(prev =>
                              prev?.id === r.id ? null : { id: r.id, anchor: btn },
                            );
                          }}
                          className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Portal-rendered action menu — escapes table overflow + table z-index */}
      {menuFor && (() => {
        const r = filtered.find(x => x.id === menuFor.id);
        if (!r) return null;
        return (
          <ActionMenu anchor={menuFor.anchor} onClose={() => setMenuFor(null)}>
            <button
              onClick={() => { setMenuFor(null); setSelectedReport(r); }}
              className="w-full text-right px-4 py-2.5 text-sm text-violet-300 hover:bg-gray-700 flex items-center gap-2"
            >
              <Eye size={14} /> عرض التفاصيل
            </button>
            {r.status !== "actioned" && (
              <button
                onClick={() => updateStatus(r.id, "actioned")}
                className="w-full text-right px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2"
              >
                <ShieldAlert size={14} /> اتخاذ إجراء
              </button>
            )}
            {r.status !== "dismissed" && (
              <button
                onClick={() => updateStatus(r.id, "dismissed")}
                className="w-full text-right px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
              >
                <XCircle size={14} /> رفض البلاغ
              </button>
            )}
            {r.status !== "pending" && (
              <button
                onClick={() => updateStatus(r.id, "pending")}
                className="w-full text-right px-4 py-2.5 text-sm text-amber-400 hover:bg-gray-700 flex items-center gap-2"
              >
                <Clock size={14} /> إعادة للمراجعة
              </button>
            )}
          </ActionMenu>
        );
      })()}

      {/* Details modal — full content, scrollable, RTL-safe */}
      {selectedReport && (
        <ReportDetailsModal
          report={selectedReport}
          updating={updating === selectedReport.id}
          onClose={() => setSelectedReport(null)}
          onAction={(s) => updateStatus(selectedReport.id, s)}
        />
      )}
    </AdminLayout>
  );
}

// ─── Details modal ───────────────────────────────────────────────────────────
function ReportDetailsModal({
  report, updating, onClose, onAction,
}: {
  report: AdminReport;
  updating: boolean;
  onClose: () => void;
  onAction: (status: ReportStatus) => void;
}) {
  const statusMeta = STATUS_META[report.status] ?? { label: report.status, style: "bg-gray-700 text-gray-300" };

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Flag size={16} className="text-violet-400 shrink-0" />
              <h2 className="text-base font-semibold text-white truncate">
                {REASON_LABELS[report.reason] ?? report.reason}
              </h2>
            </div>
            <p className="text-xs text-gray-500 font-mono truncate">{report.id}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${statusMeta.style}`}>
              {report.status === "pending" && <Clock size={10} />}
              {report.status === "actioned" && <CheckCircle size={10} />}
              {report.status === "dismissed" && <XCircle size={10} />}
              {statusMeta.label}
            </span>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body — full content, no truncation */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <Section label="نص البلاغ">
            {report.details
              ? <p className="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">{report.details}</p>
              : <p className="text-sm text-gray-500 italic">لم يُقدّم المُبلِّغ أي تفاصيل إضافية.</p>}
          </Section>

          {report.adminNote && (
            <Section label="ملاحظة المشرف">
              <p className="text-sm text-violet-300 whitespace-pre-wrap break-words leading-relaxed">{report.adminNote}</p>
            </Section>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section label="المُبلِّغ">
              {report.reporter ? (
                <div className="text-sm">
                  <div className="text-gray-200">{report.reporter.displayName ?? "—"}</div>
                  <div className="text-xs text-gray-500 font-mono mt-0.5 break-all">{report.reporter.id}</div>
                </div>
              ) : <span className="text-sm text-gray-500">—</span>}
            </Section>

            <Section label="المزاد">
              {report.auction ? (
                <div className="text-sm">
                  <div className="text-gray-200 break-words">{report.auction.title}</div>
                  <div className="text-xs text-gray-500 font-mono mt-0.5 break-all">{report.auction.id}</div>
                </div>
              ) : <span className="text-sm text-gray-500">—</span>}
            </Section>

            <Section label="تاريخ الإنشاء">
              <p className="text-sm text-gray-200">{formatDateTime(report.createdAt)}</p>
            </Section>

            {report.resolvedAt && (
              <Section label="تاريخ الحل">
                <p className="text-sm text-gray-200">{formatDateTime(report.resolvedAt)}</p>
              </Section>
            )}
          </div>
        </div>

        {/* Sticky action bar */}
        <div className="border-t border-gray-800 p-4 flex flex-wrap gap-2 justify-end bg-gray-900/95">
          {updating && <Loader2 size={16} className="text-violet-400 animate-spin self-center ml-auto" />}
          {report.status !== "actioned" && (
            <button
              disabled={updating}
              onClick={() => onAction("actioned")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50"
            >
              <ShieldAlert size={14} /> اتخاذ إجراء
            </button>
          )}
          {report.status !== "dismissed" && (
            <button
              disabled={updating}
              onClick={() => onAction("dismissed")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-700/40 text-gray-200 hover:bg-gray-700/60 disabled:opacity-50"
            >
              <XCircle size={14} /> رفض البلاغ
            </button>
          )}
          {report.status !== "pending" && (
            <button
              disabled={updating}
              onClick={() => onAction("pending")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 disabled:opacity-50"
            >
              <Clock size={14} /> إعادة للمراجعة
            </button>
          )}
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">{label}</h3>
      <div>{children}</div>
    </div>
  );
}
