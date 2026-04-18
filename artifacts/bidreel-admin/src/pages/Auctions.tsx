import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, AlertCircle, Gavel, MoreHorizontal, EyeOff, Trash2, CheckCircle, Search, X,
  ThumbsUp, ThumbsDown, Bookmark, Eye, ChevronUp, ChevronDown, ChevronsUpDown,
  TrendingUp, Clock, User, Tag, DollarSign, ChevronLeft, Minus,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminGetAuctions, adminUpdateAuction, adminDeleteAuction, type AdminAuction } from "@/services/admin-api";

interface ConfirmAction {
  label: string;
  description: string;
  variant: "danger" | "warning";
  onConfirm: () => Promise<void>;
}

type StatusFilter = "all" | "active" | "ended" | "removed";

type SortField =
  | "currentBid"
  | "bidCount"
  | "interestedCount"
  | "notInterestedCount"
  | "saveCount"
  | "createdAt"
  | "endsAt";

type SortDir = "asc" | "desc";

type MenuAnchor = {
  top?: number;
  bottom?: number;
  left: number;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** Compact view-count formatter. 1234 → "1.2K", 1_234_567 → "1.2M". */
function formatViewCount(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
}

function formatPrice(n: number, currencyCode = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currencyCode} ${n.toLocaleString("en-US")}`;
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(abs / 86_400_000);
  const future = diff < 0;

  if (mins < 60) return future ? `في ${mins} دقيقة` : `منذ ${mins} دقيقة`;
  if (hours < 24) return future ? `في ${hours} ساعة` : `منذ ${hours} ساعة`;
  return future ? `في ${days} يوم` : `منذ ${days} يوم`;
}

function auctionHealth(a: AdminAuction): { label: string; color: string; bg: string } {
  const now = Date.now();
  const ends = a.endsAt ? new Date(a.endsAt).getTime() : null;

  if (a.status === "removed") return { label: "محذوف", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" };
  if (a.status === "ended")   return { label: "منتهي", color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/20" };
  if (ends && ends < now)     return { label: "انتهى (حالة غير محدّثة)", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" };
  if (ends && ends - now < 24 * 3_600_000) return { label: "ينتهي قريباً", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" };
  return { label: "نشط", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" };
}

const STATUS_STYLES: Record<string, string> = {
  active:  "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
  ended:   "bg-gray-600/20 text-gray-400 border-gray-600/30",
  removed: "bg-red-600/20 text-red-400 border-red-600/30",
};

const STATUS_LABELS: Record<string, string> = {
  active: "نشط", ended: "منتهي", removed: "محذوف",
};

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField | null; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronsUpDown size={11} className="text-gray-600 ml-1 inline" />;
  return sortDir === "asc"
    ? <ChevronUp size={11} className="text-violet-400 ml-1 inline" />
    : <ChevronDown size={11} className="text-violet-400 ml-1 inline" />;
}

// ─── Auction detail drawer ────────────────────────────────────────────────────

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-gray-500 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-sm text-white">{children}</div>
      </div>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function AuctionDrawer({
  auction,
  onClose,
  onUpdate,
  onDelete,
}: {
  auction: AdminAuction;
  onClose: () => void;
  onUpdate: (id: string, patch: { status: "active" | "ended" | "removed" }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
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

  const net = auction.interestedCount - auction.notInterestedCount;
  const health = auctionHealth(auction);

  const appreciation = auction.startPrice > 0
    ? Math.round(((auction.currentBid - auction.startPrice) / auction.startPrice) * 100)
    : 0;

  const isEnded   = auction.status === "ended";
  const isRemoved = auction.status === "removed";
  const isActive  = auction.status === "active";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 left-0 h-full z-40 w-full max-w-sm bg-[#0d0d14] border-r border-gray-800 shadow-2xl flex flex-col overflow-hidden"
        dir="rtl"
      >
        {/* Toast */}
        {toast && (
          <div className={`absolute bottom-4 left-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
            {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
            {toast.msg}
          </div>
        )}

        {/* Confirm overlay */}
        {confirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
            <div className="w-full bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">{confirm.label}</h3>
              <p className="text-sm text-gray-400 mb-6">{confirm.description}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors">إلغاء</button>
                <button onClick={handleConfirm} disabled={confirming}
                  className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${confirm.variant === "danger" ? "bg-red-600 hover:bg-red-500" : "bg-amber-600 hover:bg-amber-500"} disabled:opacity-50`}>
                  {confirming && <Loader2 size={14} className="animate-spin" />}
                  تأكيد
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-800 shrink-0">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{auction.title}</h2>
            <div className={`mt-0.5 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-px rounded-full border ${health.bg} ${health.color}`}>
              {health.label}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

          {/* Price & bids */}
          <DrawerSection title="السعر والمزايدات">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">سعر البداية</div>
                <div className="text-base font-bold text-white">{formatPrice(auction.startPrice, auction.currencyCode)}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">أعلى مزايدة</div>
                <div className="text-base font-bold text-white">{formatPrice(auction.currentBid, auction.currencyCode)}</div>
                {appreciation > 0 && (
                  <div className="flex items-center gap-0.5 text-emerald-400 text-[10px] font-semibold mt-0.5">
                    <TrendingUp size={10} /> +{appreciation}%
                  </div>
                )}
              </div>
            </div>
            <DetailRow icon={<Gavel size={14} />} label="عدد المزايدات">
              <span className="font-semibold">{auction.bidCount}</span>
              <span className="text-gray-400 text-xs mr-1">مزايدة</span>
            </DetailRow>
          </DrawerSection>

          {/* Engagement */}
          <DrawerSection title="التفاعل">
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center">
                <ThumbsUp size={13} className="text-emerald-400 mx-auto mb-1" />
                <div className="text-sm font-bold text-white">{auction.interestedCount}</div>
                <div className="text-[9px] text-gray-500 mt-0.5">مهتم</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center">
                <ThumbsDown size={13} className="text-red-400 mx-auto mb-1" />
                <div className="text-sm font-bold text-white">{auction.notInterestedCount}</div>
                <div className="text-[9px] text-gray-500 mt-0.5">غير مهتم</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center">
                <Bookmark size={13} className="text-sky-400 mx-auto mb-1" />
                <div className="text-sm font-bold text-white">{auction.saveCount}</div>
                <div className="text-[9px] text-gray-500 mt-0.5">محفوظ</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center">
                {net > 0
                  ? <TrendingUp size={13} className="text-emerald-400 mx-auto mb-1" />
                  : net < 0
                    ? <TrendingUp size={13} className="text-red-400 mx-auto mb-1 rotate-180" />
                    : <Minus size={13} className="text-gray-500 mx-auto mb-1" />
                }
                <div className={`text-sm font-bold ${net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-gray-400"}`}>
                  {net > 0 ? `+${net}` : net}
                </div>
                <div className="text-[9px] text-gray-500 mt-0.5">الصافي</div>
              </div>
            </div>
          </DrawerSection>

          {/* Timeline */}
          <DrawerSection title="الجدول الزمني">
            <DetailRow icon={<Clock size={14} />} label="تاريخ الإنشاء">
              <div>{formatDateTime(auction.createdAt)}</div>
              <div className="text-xs text-gray-500">{relativeTime(auction.createdAt)}</div>
            </DetailRow>
            <DetailRow icon={<Clock size={14} />} label={isEnded || isRemoved ? "انتهى في" : "ينتهي في"}>
              <div>{formatDateTime(auction.endsAt)}</div>
              <div className="text-xs text-gray-500">{relativeTime(auction.endsAt)}</div>
            </DetailRow>
          </DrawerSection>

          {/* Seller & info */}
          <DrawerSection title="المعلومات">
            <DetailRow icon={<User size={14} />} label="البائع">
              {auction.seller?.displayName ?? <span className="text-gray-500">—</span>}
            </DetailRow>
            <DetailRow icon={<Tag size={14} />} label="الفئة">
              {auction.category ?? <span className="text-gray-500">—</span>}
            </DetailRow>
            <DetailRow icon={<DollarSign size={14} />} label="العملة">
              {auction.currencyCode} · {auction.currencyLabel}
            </DetailRow>
          </DrawerSection>

        </div>

        {/* Actions footer */}
        <div className="px-4 py-3 border-t border-gray-800 space-y-2 shrink-0">
          {isActive && (
            <button
              onClick={() => setConfirm({
                label: "إخفاء المزاد",
                description: "سيتم إزالة المزاد من الفيد العام.",
                variant: "warning",
                onConfirm: async () => {
                  await onUpdate(auction.id, { status: "removed" });
                },
              })}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-600/30 bg-amber-600/10 text-amber-400 text-sm font-semibold hover:bg-amber-600/20 transition-colors"
            >
              <EyeOff size={14} /> إخفاء المزاد
            </button>
          )}
          {isRemoved && (
            <button
              onClick={() => setConfirm({
                label: "استعادة المزاد",
                description: "سيعود المزاد إلى الفيد العام.",
                variant: "warning",
                onConfirm: async () => {
                  await onUpdate(auction.id, { status: "active" });
                },
              })}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-emerald-600/30 bg-emerald-600/10 text-emerald-400 text-sm font-semibold hover:bg-emerald-600/20 transition-colors"
            >
              <CheckCircle size={14} /> استعادة المزاد
            </button>
          )}
          <button
            onClick={() => setConfirm({
              label: "حذف المزاد نهائياً",
              description: "سيتم حذف المزاد وجميع مزايداته بشكل دائم. لا يمكن التراجع.",
              variant: "danger",
              onConfirm: async () => {
                await onDelete(auction.id);
                onClose();
              },
            })}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-600/30 bg-red-600/10 text-red-400 text-sm font-semibold hover:bg-red-600/20 transition-colors"
          >
            <Trash2 size={14} /> حذف نهائي
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Main Auctions page ───────────────────────────────────────────────────────

export default function Auctions() {
  const [auctions, setAuctions] = useState<AdminAuction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedAuction, setSelectedAuction] = useState<AdminAuction | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

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

  function openMenuAtButton(auctionId: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (openMenu === auctionId) {
      setOpenMenu(null);
      setMenuAnchor(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 192; // w-48
    const menuHeight = 100;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < menuHeight + 8;
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    setOpenMenu(auctionId);
    setMenuAnchor(
      openUpward
        ? { bottom: window.innerHeight - rect.top + 4, left }
        : { top: rect.bottom + 4, left },
    );
  }

  useEffect(() => {
    adminGetAuctions()
      .then(setAuctions)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = auctions.filter(a => {
      if (q) {
        const titleMatch = a.title.toLowerCase().includes(q);
        const sellerMatch = (a.seller?.displayName ?? "").toLowerCase().includes(q);
        const categoryMatch = (a.category ?? "").toLowerCase().includes(q);
        if (!titleMatch && !sellerMatch && !categoryMatch) return false;
      }
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    });

    if (sortField) {
      list = [...list].sort((a, b) => {
        let av: number | string;
        let bv: number | string;
        if (sortField === "createdAt" || sortField === "endsAt") {
          av = a[sortField] ?? "";
          bv = b[sortField] ?? "";
        } else {
          av = a[sortField] as number;
          bv = b[sortField] as number;
        }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [auctions, search, statusFilter, sortField, sortDir]);

  function runConfirm(action: ConfirmAction) {
    setOpenMenu(null);
    setMenuAnchor(null);
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

  async function handleDrawerUpdate(id: string, patch: { status: "active" | "ended" | "removed" }) {
    await adminUpdateAuction(id, patch);
    setAuctions(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    setSelectedAuction(prev => prev?.id === id ? { ...prev, ...patch } : prev);
    showToast("تم تنفيذ الإجراء");
  }

  async function handleDrawerDelete(id: string) {
    await adminDeleteAuction(id);
    setAuctions(prev => prev.filter(x => x.id !== id));
    setSelectedAuction(null);
    showToast("تم حذف المزاد");
  }

  const hasFilters = search.trim() || statusFilter !== "all";

  return (
    <AdminLayout title="المزادات">
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
              <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors">إلغاء</button>
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
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بعنوان المزاد أو البائع…" dir="rtl"
              className="w-full pl-9 pr-4 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 transition" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X size={14} /></button>}
          </div>

          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500 transition" dir="rtl">
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="ended">منتهي</option>
            <option value="removed">محذوف</option>
          </select>

          {hasFilters && (
            <button onClick={() => { setSearch(""); setStatusFilter("all"); }} className="text-xs text-gray-500 hover:text-white transition flex items-center gap-1">
              <X size={12} /> إلغاء الفلاتر
            </button>
          )}

          <span className="text-xs text-gray-500 ml-auto">{filtered.length} مزاد</span>
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
          <Gavel size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{auctions.length === 0 ? "لا مزادات بعد" : "لا نتائج تطابق البحث"}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">العنوان</th>
                <th className="text-left px-4 py-3 font-semibold">البائع</th>
                <th
                  className="text-left px-4 py-3 font-semibold cursor-pointer hover:text-gray-200 select-none transition-colors"
                  onClick={() => toggleSort("currentBid")}
                >
                  أعلى مزايدة <SortIcon field="currentBid" sortField={sortField} sortDir={sortDir} />
                </th>
                <th
                  className="text-left px-4 py-3 font-semibold cursor-pointer hover:text-gray-200 select-none transition-colors"
                  onClick={() => toggleSort("bidCount")}
                >
                  المزايدات <SortIcon field="bidCount" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className="text-left px-4 py-3 font-semibold">الحالة</th>
                <th className="text-left px-4 py-3 font-semibold">
                  <span title="مهتم · غير مهتم · محفوظات">التفاعل</span>
                </th>
                <th className="text-left px-4 py-3 font-semibold">
                  <span title="مشاهدات مؤهلة · مشاهدون فريدون · مشاهدات تفاعلية">المشاهدات</span>
                </th>
                <th
                  className="text-left px-4 py-3 font-semibold cursor-pointer hover:text-gray-200 select-none transition-colors"
                  onClick={() => toggleSort("createdAt")}
                >
                  الإنشاء <SortIcon field="createdAt" sortField={sortField} sortDir={sortDir} />
                </th>
                <th
                  className="text-left px-4 py-3 font-semibold cursor-pointer hover:text-gray-200 select-none transition-colors"
                  onClick={() => toggleSort("endsAt")}
                >
                  ينتهي <SortIcon field="endsAt" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(a => {
                const net = a.interestedCount - a.notInterestedCount;
                const netLabel = net > 0 ? `+${net}` : net < 0 ? `${net}` : null;
                const netStyle = net > 0
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                  : "bg-red-500/15 text-red-400 border-red-500/25";

                return (
                  <tr
                    key={a.id}
                    className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={e => {
                      // Don't open drawer when clicking the action menu button
                      const target = e.target as HTMLElement;
                      if (target.closest("[data-action-menu]")) return;
                      setSelectedAuction(a);
                    }}
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-white max-w-[200px] truncate">{a.title}</div>
                      <div className="text-xs text-gray-500">{a.category}</div>
                    </td>
                    <td className="px-4 py-3.5 text-gray-300 text-xs">{a.seller?.displayName ?? "—"}</td>
                    <td className="px-4 py-3.5 text-white font-semibold">{formatPrice(a.currentBid, a.currencyCode)}</td>
                    <td className="px-4 py-3.5">
                      <span className="text-white font-semibold">{a.bidCount}</span>
                      <span className="text-gray-500 text-xs mr-1">مزايدة</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[a.status] ?? "bg-gray-700 text-gray-300"}`}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold" title="مهتم">
                          <ThumbsUp size={11} /> {a.interestedCount}
                        </span>
                        <span className="flex items-center gap-1 text-red-400 text-xs font-semibold" title="غير مهتم">
                          <ThumbsDown size={11} /> {a.notInterestedCount}
                        </span>
                        <span className="flex items-center gap-1 text-sky-400 text-xs font-semibold" title="محفوظات">
                          <Bookmark size={11} /> {a.saveCount}
                        </span>
                        {netLabel && (
                          <span className={`inline-flex px-1.5 py-px rounded text-[10px] font-bold border ${netStyle}`}>
                            {netLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {/* Views: qualified · unique · engaged. Hidden when zero across the board. */}
                      {(a.qualifiedViewsCount + a.uniqueViewersCount + a.engagedViewsCount) > 0 ? (
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="flex items-center gap-1 text-violet-400 text-xs font-semibold tabular-nums" title="مشاهدات مؤهلة (≥2 ثانية)">
                            <Eye size={11} /> {formatViewCount(a.qualifiedViewsCount)}
                          </span>
                          <span className="flex items-center gap-1 text-indigo-300/80 text-xs font-semibold tabular-nums" title="مشاهدون فريدون">
                            <User size={11} /> {formatViewCount(a.uniqueViewersCount)}
                          </span>
                          <span className="flex items-center gap-1 text-amber-300/80 text-xs font-semibold tabular-nums" title="مشاهدات تفاعلية (لايك / حفظ / مزايدة)">
                            <TrendingUp size={11} /> {formatViewCount(a.engagedViewsCount)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs">{formatDate(a.endsAt)}</td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={e => openMenuAtButton(a.id, e)}
                        className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selectedAuction && (
        <AuctionDrawer
          auction={selectedAuction}
          onClose={() => setSelectedAuction(null)}
          onUpdate={handleDrawerUpdate}
          onDelete={handleDrawerDelete}
        />
      )}

      {/* Action menu portal — renders outside overflow-x-auto to avoid clipping */}
      {(() => {
        const openMenuAuction = openMenu ? auctions.find(a => a.id === openMenu) ?? null : null;
        if (!openMenuAuction || !menuAnchor) return null;
        return createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top:    menuAnchor.top,
              bottom: menuAnchor.bottom,
              left:   menuAnchor.left,
              zIndex: 9999,
            }}
            className="w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
            dir="rtl"
          >
            {openMenuAuction.status !== "removed" ? (
              <button
                onClick={e => { e.stopPropagation(); runConfirm({
                  label: "إخفاء المزاد", description: "سيتم إزالة المزاد من الفيد العام.", variant: "warning",
                  onConfirm: async () => {
                    await adminUpdateAuction(openMenuAuction.id, { status: "removed" });
                    setAuctions(prev => prev.map(x => x.id === openMenuAuction.id ? { ...x, status: "removed" } : x));
                    setSelectedAuction(prev => prev?.id === openMenuAuction.id ? { ...prev, status: "removed" } : prev);
                  },
                }); }}
                className="w-full text-right px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
              >
                <EyeOff size={14} className="text-amber-400" /> إخفاء المزاد
              </button>
            ) : (
              <button
                onClick={async e => { e.stopPropagation(); setOpenMenu(null); setMenuAnchor(null);
                  try {
                    await adminUpdateAuction(openMenuAuction.id, { status: "active" });
                    setAuctions(prev => prev.map(x => x.id === openMenuAuction.id ? { ...x, status: "active" } : x));
                    setSelectedAuction(prev => prev?.id === openMenuAuction.id ? { ...prev, status: "active" } : prev);
                    showToast("تم استعادة المزاد");
                  } catch (err) { showToast((err as Error).message, false); }
                }}
                className="w-full text-right px-4 py-2.5 text-sm text-emerald-400 hover:bg-gray-700 flex items-center gap-2"
              >
                <CheckCircle size={14} /> استعادة المزاد
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); runConfirm({
                label: "حذف المزاد نهائياً", description: "سيتم حذف المزاد وجميع مزايداته بشكل دائم. لا يمكن التراجع.", variant: "danger",
                onConfirm: async () => {
                  await adminDeleteAuction(openMenuAuction.id);
                  setAuctions(prev => prev.filter(x => x.id !== openMenuAuction.id));
                  setSelectedAuction(prev => prev?.id === openMenuAuction.id ? null : prev);
                },
              }); }}
              className="w-full text-right px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
            >
              <Trash2 size={14} /> حذف نهائي
            </button>
          </div>,
          document.body,
        );
      })()}
    </AdminLayout>
  );
}
