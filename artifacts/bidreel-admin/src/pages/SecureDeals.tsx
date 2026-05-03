import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Package, DollarSign, Clock, CheckCircle2,
  Truck, Link2, ChevronDown, ChevronUp, X,
  AlertCircle, FileText, Search, Banknote, Info, ExternalLink,
  Star, Phone, MapPin, RefreshCw, User, Loader2, ScrollText, MessageSquare,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  adminGetPaymentProofs,  type AdminPaymentProof,
  adminGetShipmentProofs, type AdminShipmentProof,
  adminGetFullDeals,      type FullDeal, type FullDealUser, type FullDealRating,
} from "@/services/admin-api";

// ── Types ─────────────────────────────────────────────────────────────────────

type PayStatus  = "awaiting" | "secured";
type ShipStatus = "pending"  | "verified" | "delivered";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMMISSION_RATE = 0.05;

const PAY_BADGE: Record<PayStatus, { label: string; cls: string }> = {
  awaiting: { label: "بانتظار الدفع",  cls: "bg-amber-500/12 text-amber-400 border-amber-500/25" },
  secured:  { label: "تم تأمين الدفع", cls: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25" },
};
const SHIP_BADGE: Record<ShipStatus, { label: string; cls: string }> = {
  pending:   { label: "قيد الانتظار", cls: "bg-gray-500/12 text-gray-400 border-gray-500/20" },
  verified:  { label: "تم التحقق",    cls: "bg-blue-500/12 text-blue-400 border-blue-500/25" },
  delivered: { label: "تم التسليم",   cls: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25" },
};

function Badge({ cfg }: { cfg: { label: string; cls: string } }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function fmt(n: number, currency: string) {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function payStatus(d: FullDeal): PayStatus {
  return d.payment_status === "secured" ? "secured" : "awaiting";
}

function shipStatus(d: FullDeal): ShipStatus {
  if (d.shipment_status === "delivered") return "delivered";
  if (d.shipment_status === "verified")  return "verified";
  return "pending";
}

function userName(u: FullDealUser | null): string {
  return u?.display_name || u?.username || "—";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ar-SA", { dateStyle: "medium" });
}

function StarRow({ stars }: { stars: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star
          key={i}
          size={11}
          className={i <= stars ? "text-amber-400 fill-amber-400" : "text-white/15"}
        />
      ))}
    </div>
  );
}

// ── Collapsible sub-section ───────────────────────────────────────────────────

function SubSection({
  title, icon, count, defaultOpen = true, children,
}: {
  title: string; icon: React.ReactNode; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl bg-white/3 border border-white/8 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-white/60">
          {icon}
          <span>{title}</span>
          {count !== undefined && (
            <span className="bg-white/10 border border-white/10 text-white/40 text-[9px] font-bold px-1.5 py-0.5 rounded-md">
              {count}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp   size={12} className="text-white/25" />
          : <ChevronDown size={12} className="text-white/25" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// ── User card ─────────────────────────────────────────────────────────────────

function UserCard({ label, user, userId }: { label: string; user: FullDealUser | null; userId: string | null }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{label}</p>
      {user ? (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/8 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                : <User size={13} className="text-white/30" />}
            </div>
            <div>
              <p className="font-semibold text-white/85 leading-tight">{user.display_name || user.username || "—"}</p>
              {user.username && user.display_name && (
                <p className="text-white/30 text-[10px]">@{user.username}</p>
              )}
            </div>
          </div>
          {user.phone && (
            <div className="flex items-center gap-1.5 text-white/45">
              <Phone size={10} className="text-white/25 shrink-0" />
              <span dir="ltr">{user.phone}</span>
            </div>
          )}
          {(user.location || user.country) && (
            <div className="flex items-center gap-1.5 text-white/45">
              <MapPin size={10} className="text-white/25 shrink-0" />
              <span>{[user.location, user.country].filter(Boolean).join("، ")}</span>
            </div>
          )}
          <p className="text-[10px] text-white/20 font-mono truncate pt-0.5">{userId}</p>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-white/25 italic">
          <User size={11} />
          <span>{userId ? "لم يتم جلب الملف الشخصي" : "لم يُعيَّن بعد"}</span>
        </div>
      )}
    </div>
  );
}

// ── Full Deal Expanded Row ────────────────────────────────────────────────────

function FullDealExpandedRow({ deal }: { deal: FullDeal }) {
  const [releasing, setReleasing] = useState(false);
  const [released,  setReleased]  = useState(deal.funds_released);

  const ps         = payStatus(deal);
  const ss         = shipStatus(deal);
  const commission   = deal.price * COMMISSION_RATE;
  const sellerAmount = deal.price - commission;
  const canRelease   = ps === "secured" && ss !== "pending" && !released;

  function handleReleaseFunds() {
    if (releasing || released) return;
    setReleasing(true);
    setTimeout(() => { setReleased(true); setReleasing(false); }, 1200);
  }

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <td colSpan={9} className="bg-white/2 border-b border-white/6 px-5 py-5">
        <div className="space-y-3 max-w-6xl" dir="rtl">

          {/* Row 1: Parties */}
          <SubSection title="الأطراف" icon={<User size={12} className="text-sky-400" />} defaultOpen>
            <div className="grid grid-cols-2 gap-6">
              <UserCard label="البائع" user={deal.seller} userId={deal.seller_id} />
              <UserCard label="المشتري" user={deal.buyer}  userId={deal.buyer_id} />
            </div>
          </SubSection>

          {/* Row 2: Proofs + Conditions + Ratings in 3 cols */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">

            {/* Payment Proof */}
            <SubSection title="إثبات الدفع" icon={<FileText size={12} className="text-sky-400" />} defaultOpen>
              {deal.payment_proof ? (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-1.5 text-white/60">
                    <FileText size={10} className="text-sky-400 shrink-0" />
                    <span className="truncate">{deal.payment_proof.file_name}</span>
                  </div>
                  <div className="text-[10px] text-white/30">
                    {deal.payment_proof.file_type.split("/")[1]?.toUpperCase() ?? deal.payment_proof.file_type}
                    {deal.payment_proof.file_size != null && ` · ${(deal.payment_proof.file_size / 1024).toFixed(0)} KB`}
                  </div>
                  <div className="text-[10px] text-white/30">{fmtDate(deal.payment_proof.uploaded_at)}</div>
                  <div className="flex gap-2 pt-1">
                    <a
                      href={deal.payment_proof.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/25 text-sky-300 text-[11px] font-bold hover:brightness-110 transition"
                    >
                      <ExternalLink size={10} /> عرض
                    </a>
                    <a
                      href={deal.payment_proof.file_url}
                      download
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/6 border border-white/10 text-white/50 text-[11px] font-bold hover:brightness-110 transition"
                    >
                      تنزيل
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/25 italic">لم يُرفع إثبات الدفع بعد.</p>
              )}
            </SubSection>

            {/* Shipment Proof */}
            <SubSection title="إثبات الشحن" icon={<Truck size={12} className="text-orange-400" />} defaultOpen>
              {deal.shipment_proof ? (
                <div className="space-y-2 text-xs">
                  {deal.shipment_proof.tracking_link && (
                    <a
                      href={deal.shipment_proof.tracking_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1.5 text-orange-300 hover:text-orange-200 transition truncate"
                    >
                      <Link2 size={10} className="shrink-0" />
                      <span className="truncate text-[11px]">{deal.shipment_proof.tracking_link}</span>
                    </a>
                  )}
                  <div className="text-[10px] text-white/30">{fmtDate(deal.shipment_proof.uploaded_at)}</div>
                  <div className="flex gap-2 pt-1">
                    <a
                      href={deal.shipment_proof.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/25 text-orange-300 text-[11px] font-bold hover:brightness-110 transition"
                    >
                      <ExternalLink size={10} /> عرض
                    </a>
                    <a
                      href={deal.shipment_proof.file_url}
                      download
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/6 border border-white/10 text-white/50 text-[11px] font-bold hover:brightness-110 transition"
                    >
                      تنزيل
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/25 italic">لم يُرفع إثبات الشحن بعد.</p>
              )}
            </SubSection>

            {/* Release Funds */}
            <SubSection title="تحرير الأموال" icon={<Banknote size={12} className={released ? "text-emerald-400" : canRelease ? "text-amber-400" : "text-white/30"} />} defaultOpen>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-white/50">
                  <span className="text-white/35">إجمالي المبلغ</span>
                  <span>{fmt(deal.price, deal.currency)}</span>
                </div>
                <div className="flex justify-between text-white/50">
                  <span className="flex items-center gap-1 text-white/35">
                    عمولة بيدريل (5%) <Info size={9} className="text-white/20" />
                  </span>
                  <span className="text-amber-400">– {fmt(commission, deal.currency)}</span>
                </div>
                <div className="flex justify-between border-t border-white/8 pt-1.5">
                  <span className="font-bold text-white/60">يستلم البائع</span>
                  <span className="font-bold text-emerald-400">{fmt(sellerAmount, deal.currency)}</span>
                </div>
                <AnimatePresence mode="wait">
                  {released ? (
                    <motion.div
                      key="done"
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[11px] font-bold mt-1"
                    >
                      <CheckCircle2 size={12} /> تم تحرير الأموال
                    </motion.div>
                  ) : (
                    <motion.div key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5 mt-1">
                      <button
                        onClick={handleReleaseFunds}
                        disabled={!canRelease || releasing}
                        className={`w-full py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition ${
                          canRelease && !releasing
                            ? "bg-amber-500/80 text-white hover:brightness-110"
                            : "bg-white/5 text-white/20 border border-white/8 cursor-not-allowed"
                        }`}
                      >
                        {releasing
                          ? <><div className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />جارٍ التحرير...</>
                          : <><Banknote size={12} />تحرير الأموال للبائع</>}
                      </button>
                      {!canRelease && (
                        <p className="text-[10px] text-white/25 text-center leading-snug">
                          {ps !== "secured" ? "يجب تأمين الدفع أولاً" : "يجب التحقق من الشحن أولاً"}
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </SubSection>
          </div>

          {/* Row 3: Conditions + Ratings */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">

            {/* Buyer Conditions */}
            <SubSection title="شروط المشتري" icon={<ScrollText size={12} className="text-violet-400" />} defaultOpen={false}>
              {deal.buyer_conditions ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-white/65 leading-relaxed whitespace-pre-wrap">{deal.buyer_conditions.conditions}</p>
                  <p className="text-[10px] text-white/25">{fmtDate(deal.buyer_conditions.created_at)}</p>
                </div>
              ) : (
                <p className="text-xs text-white/25 italic">لم تُحدَّد شروط المشتري بعد.</p>
              )}
            </SubSection>

            {/* Seller Conditions */}
            <SubSection title="شروط البائع" icon={<ScrollText size={12} className="text-indigo-400" />} defaultOpen={false}>
              {deal.seller_conditions ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-white/65 leading-relaxed whitespace-pre-wrap">{deal.seller_conditions.conditions}</p>
                  <p className="text-[10px] text-white/25">{fmtDate(deal.seller_conditions.created_at)}</p>
                </div>
              ) : (
                <p className="text-xs text-white/25 italic">لم تُحدَّد شروط البائع بعد.</p>
              )}
            </SubSection>

            {/* Ratings */}
            <SubSection title="التقييمات" icon={<Star size={12} className="text-amber-400" />} count={deal.ratings.length} defaultOpen={false}>
              {deal.ratings.length > 0 ? (
                <div className="space-y-3">
                  {deal.ratings.map((r: FullDealRating) => {
                    const raterIsSeller = r.rater_id === deal.seller_id;
                    return (
                      <div key={r.id} className="space-y-1.5 pb-3 border-b border-white/6 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-white/40">{raterIsSeller ? "تقييم البائع" : "تقييم المشتري"}</span>
                          <StarRow stars={r.stars} />
                        </div>
                        {r.comment && (
                          <div className="flex items-start gap-1.5 text-xs text-white/55">
                            <MessageSquare size={10} className="text-white/20 shrink-0 mt-0.5" />
                            <p className="leading-relaxed">{r.comment}</p>
                          </div>
                        )}
                        <p className="text-[10px] text-white/20">{fmtDate(r.created_at)}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/25 italic">لا توجد تقييمات بعد.</p>
              )}
            </SubSection>
          </div>

          {/* Description / Terms */}
          {(deal.description || deal.terms) && (
            <SubSection title="وصف الصفقة / الشروط العامة" icon={<Info size={12} className="text-white/30" />} defaultOpen={false}>
              <div className="space-y-3">
                {deal.description && (
                  <div>
                    <p className="text-[10px] text-white/30 mb-1">الوصف</p>
                    <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{deal.description}</p>
                  </div>
                )}
                {deal.terms && (
                  <div>
                    <p className="text-[10px] text-white/30 mb-1">الشروط</p>
                    <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{deal.terms}</p>
                  </div>
                )}
              </div>
            </SubSection>
          )}

        </div>
      </td>
    </motion.tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SecureDeals() {
  const [fullDeals,        setFullDeals]       = useState<FullDeal[]>([]);
  const [dealsLoading,     setDealsLoading]    = useState(false);
  const [dealsError,       setDealsError]      = useState<string | null>(null);
  const [dealsTotal,       setDealsTotal]      = useState(0);
  const [refreshTick,      setRefreshTick]     = useState(0);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [filterPay,  setFilterPay]  = useState<PayStatus | "all">("all");
  const [filterShip, setFilterShip] = useState<ShipStatus | "all">("all");

  // Payment proofs — real data from API (Part #4)
  const [proofs,           setProofs]           = useState<AdminPaymentProof[]>([]);
  const [proofsLoading,    setProofsLoading]    = useState(false);
  const [proofsError,      setProofsError]      = useState<string | null>(null);
  const [proofsExpanded,   setProofsExpanded]   = useState(true);

  // Shipment proofs — real data from API (Part #5)
  const [shipmentProofs,         setShipmentProofs]         = useState<AdminShipmentProof[]>([]);
  const [shipmentProofsLoading,  setShipmentProofsLoading]  = useState(false);
  const [shipmentProofsError,    setShipmentProofsError]    = useState<string | null>(null);
  const [shipmentProofsExpanded, setShipmentProofsExpanded] = useState(true);

  // ── Fetch full deals ────────────────────────────────────────────────────────
  useEffect(() => {
    setDealsLoading(true);
    setDealsError(null);
    adminGetFullDeals(1, 100)
      .then(res => {
        setFullDeals(res.deals);
        setDealsTotal(res.total);
      })
      .catch(err => setDealsError((err as Error).message ?? "فشل تحميل الصفقات"))
      .finally(() => setDealsLoading(false));
  }, [refreshTick]);

  // ── Fetch payment proofs ────────────────────────────────────────────────────
  useEffect(() => {
    setProofsLoading(true);
    adminGetPaymentProofs()
      .then(data => { setProofs(data); setProofsError(null); })
      .catch(err  => setProofsError((err as Error).message ?? "فشل تحميل إثباتات الدفع"))
      .finally(()  => setProofsLoading(false));
  }, [refreshTick]);

  // ── Fetch shipment proofs ───────────────────────────────────────────────────
  useEffect(() => {
    setShipmentProofsLoading(true);
    adminGetShipmentProofs()
      .then(data => { setShipmentProofs(data); setShipmentProofsError(null); })
      .catch(err  => setShipmentProofsError((err as Error).message ?? "فشل تحميل إثباتات الشحن"))
      .finally(()  => setShipmentProofsLoading(false));
  }, [refreshTick]);

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filtered = fullDeals.filter(d => {
    const q = search.toLowerCase();
    const matchQ = !q
      || d.deal_id.toLowerCase().includes(q)
      || d.product_name.toLowerCase().includes(q)
      || (d.seller?.display_name ?? "").toLowerCase().includes(q)
      || (d.seller?.username     ?? "").toLowerCase().includes(q)
      || (d.buyer?.display_name  ?? "").toLowerCase().includes(q)
      || (d.buyer?.username      ?? "").toLowerCase().includes(q);
    const matchPay  = filterPay  === "all" || payStatus(d)  === filterPay;
    const matchShip = filterShip === "all" || shipStatus(d) === filterShip;
    return matchQ && matchPay && matchShip;
  });

  const summaryStats = {
    total:         fullDeals.length,
    secured:       fullDeals.filter(d => d.payment_status === "secured").length,
    pending:       fullDeals.filter(d => shipStatus(d) === "pending").length,
    verified:      fullDeals.filter(d => shipStatus(d) === "verified").length,
    fundsReleased: fullDeals.filter(d => d.funds_released).length,
  };

  return (
    <AdminLayout title="الصفقات الآمنة">
      <div className="space-y-5 max-w-7xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <ShieldCheck size={18} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white" dir="rtl">الصفقات الآمنة</h1>
              <p className="text-[11px] text-white/35" dir="rtl">إدارة ومتابعة الصفقات المحمية · {dealsTotal} صفقة</p>
            </div>
          </div>

          <button
            onClick={() => { setExpanded(null); setRefreshTick(t => t + 1); }}
            disabled={dealsLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/50 text-xs font-medium hover:bg-white/10 hover:text-white/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {dealsLoading
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
            تحديث
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3" dir="rtl">
          {[
            { label: "إجمالي الصفقات", value: summaryStats.total,         icon: <ShieldCheck size={15} />, cls: "text-white/60   bg-white/5       border-white/10" },
            { label: "مدفوعات مؤمّنة", value: summaryStats.secured,       icon: <DollarSign  size={15} />, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
            { label: "شحن معلّق",       value: summaryStats.pending,       icon: <Clock       size={15} />, cls: "text-amber-400  bg-amber-500/10   border-amber-500/20" },
            { label: "تم التحقق",       value: summaryStats.verified,      icon: <Truck       size={15} />, cls: "text-blue-400   bg-blue-500/10    border-blue-500/20" },
            { label: "أموال محرَّرة",   value: summaryStats.fundsReleased, icon: <Banknote    size={15} />, cls: "text-violet-400 bg-violet-500/10  border-violet-500/20" },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border px-4 py-3.5 flex items-center gap-3 ${s.cls}`}>
              {s.icon}
              <div>
                <div className="text-xl font-bold text-white leading-tight">{s.value}</div>
                <div className="text-[10px] text-white/40 font-medium mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Payment Proofs Panel ── */}
        <div className="rounded-2xl border border-white/8 overflow-hidden" dir="rtl">
          <button
            onClick={() => setProofsExpanded(p => !p)}
            className="w-full flex items-center justify-between px-5 py-4 bg-white/3 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <FileText size={14} className="text-sky-400" />
              <span className="text-sm font-bold text-white/80">إثباتات الدفع</span>
              {!proofsLoading && proofs.length > 0 && (
                <span className="bg-sky-500/20 border border-sky-500/30 text-sky-300 text-[10px] font-bold px-1.5 py-0.5 rounded-lg">
                  {proofs.length}
                </span>
              )}
            </div>
            {proofsExpanded ? <ChevronUp size={14} className="text-white/30" /> : <ChevronDown size={14} className="text-white/30" />}
          </button>

          <AnimatePresence>
            {proofsExpanded && (
              <motion.div
                key="proofs-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: "hidden" }}
              >
                {proofsLoading ? (
                  <div className="px-5 py-8 text-center text-white/25 text-sm">جارٍ التحميل…</div>
                ) : proofsError ? (
                  <div className="px-5 py-6 flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle size={14} className="shrink-0" /> {proofsError}
                  </div>
                ) : proofs.length === 0 ? (
                  <div className="px-5 py-8 text-center text-white/25 text-sm">لم يُرفع أي إثبات دفع بعد.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/6 text-right bg-white/2">
                          {["رقم الصفقة","المنتج","السعر","اسم الملف","النوع","الحجم","تاريخ الرفع",""].map(h => (
                            <th key={h} className="px-4 py-2.5 text-[10px] font-bold text-white/30 uppercase tracking-widest whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {proofs.map((p, i) => (
                          <tr key={p.id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${i % 2 === 0 ? "" : "bg-white/1"}`} dir="rtl">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-mono text-[11px] font-bold text-white/60 bg-white/5 border border-white/8 rounded-lg px-2 py-0.5">{p.deal_id}</span>
                            </td>
                            <td className="px-4 py-3 max-w-[180px]"><span className="text-white/75 text-[12px] truncate block">{p.product_name ?? "—"}</span></td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-white font-bold text-[12px]">{Number(p.price).toLocaleString()}</span>
                              <span className="text-white/40 text-[11px] ms-1">{p.currency}</span>
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              <div className="flex items-center gap-1.5">
                                <FileText size={11} className="text-sky-400 shrink-0" />
                                <span className="text-white/70 text-[12px] truncate">{p.file_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-white/40 text-[11px]">{p.file_type.split("/")[1]?.toUpperCase() ?? p.file_type}</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-white/40 text-[11px]">{p.file_size ? `${(p.file_size / 1024).toFixed(0)} KB` : "—"}</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-white/50 text-[11px]">{new Date(p.uploaded_at).toLocaleDateString("ar-SA", { dateStyle: "short" })}</span>
                            </td>
                            <td className="px-4 py-3">
                              <a href={p.file_url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/25 text-sky-300 text-[11px] font-bold hover:brightness-110 transition whitespace-nowrap">
                                <ExternalLink size={11} /> عرض
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Shipment Proofs Panel ── */}
        <div className="rounded-2xl bg-white/3 border border-white/8 overflow-hidden">
          <button
            onClick={() => setShipmentProofsExpanded(p => !p)}
            className="w-full flex items-center justify-between px-5 py-4 bg-white/3 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Truck size={14} className="text-orange-400" />
              <span className="text-sm font-bold text-white/80">إثباتات الشحن</span>
              {!shipmentProofsLoading && shipmentProofs.length > 0 && (
                <span className="bg-orange-500/20 border border-orange-500/30 text-orange-300 text-[10px] font-bold px-1.5 py-0.5 rounded-lg">
                  {shipmentProofs.length}
                </span>
              )}
            </div>
            {shipmentProofsExpanded ? <ChevronUp size={14} className="text-white/30" /> : <ChevronDown size={14} className="text-white/30" />}
          </button>

          <AnimatePresence>
            {shipmentProofsExpanded && (
              <motion.div
                key="shipment-proofs-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: "hidden" }}
              >
                {shipmentProofsLoading ? (
                  <div className="px-5 py-8 text-center text-white/25 text-sm">جارٍ التحميل…</div>
                ) : shipmentProofsError ? (
                  <div className="px-5 py-6 flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle size={14} className="shrink-0" /> {shipmentProofsError}
                  </div>
                ) : shipmentProofs.length === 0 ? (
                  <div className="px-5 py-8 text-center text-white/25 text-sm">لم يُرفع أي إثبات شحن بعد.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/6 text-right bg-white/2">
                          {["رقم الصفقة","المنتج","السعر","رابط التتبع","تاريخ الرفع","",""].map((h, i) => (
                            <th key={i} className="px-4 py-2.5 text-[10px] font-bold text-white/30 uppercase tracking-widest whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shipmentProofs.map((sp, i) => (
                          <tr key={sp.id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${i % 2 === 0 ? "" : "bg-white/1"}`} dir="rtl">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-mono text-[11px] font-bold text-white/60 bg-white/5 border border-white/8 rounded-lg px-2 py-0.5">{sp.deal_id}</span>
                            </td>
                            <td className="px-4 py-3 max-w-[180px]"><span className="text-white/75 text-[12px] truncate block">{sp.product_name ?? "—"}</span></td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-white font-bold text-[12px]">{Number(sp.price).toLocaleString()}</span>
                              <span className="text-white/40 text-[11px] ms-1">{sp.currency}</span>
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              {sp.tracking_link ? (
                                <a href={sp.tracking_link} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-orange-300 text-[12px] hover:underline truncate">
                                  <Link2 size={11} className="shrink-0" />
                                  <span className="truncate">{sp.tracking_link}</span>
                                </a>
                              ) : (
                                <span className="text-white/25 text-[11px]">لا يوجد</span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-white/50 text-[11px]">{new Date(sp.uploaded_at).toLocaleDateString("ar-SA", { dateStyle: "short" })}</span>
                            </td>
                            <td className="px-4 py-3">
                              <a href={sp.file_url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/25 text-orange-300 text-[11px] font-bold hover:brightness-110 transition whitespace-nowrap">
                                <ExternalLink size={11} /> عرض
                              </a>
                            </td>
                            <td className="px-4 py-3">
                              <a href={sp.file_url} download
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/6 border border-white/10 text-white/50 text-[11px] font-bold hover:brightness-110 transition whitespace-nowrap">
                                تنزيل
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Filters + Search ── */}
        <div className="flex flex-wrap items-center gap-2.5" dir="rtl">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالرقم / المنتج / الاسم..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pr-9 pl-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary/40 transition"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition">
                <X size={13} />
              </button>
            )}
          </div>

          <select
            value={filterPay}
            onChange={e => setFilterPay(e.target.value as PayStatus | "all")}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-primary/40 transition cursor-pointer"
            dir="rtl"
          >
            <option value="all"       className="bg-[#0c0c14]">كل حالات الدفع</option>
            <option value="awaiting"  className="bg-[#0c0c14]">بانتظار الدفع</option>
            <option value="secured"   className="bg-[#0c0c14]">تم تأمين الدفع</option>
          </select>

          <select
            value={filterShip}
            onChange={e => setFilterShip(e.target.value as ShipStatus | "all")}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-primary/40 transition cursor-pointer"
            dir="rtl"
          >
            <option value="all"       className="bg-[#0c0c14]">كل حالات الشحن</option>
            <option value="pending"   className="bg-[#0c0c14]">قيد الانتظار</option>
            <option value="verified"  className="bg-[#0c0c14]">تم التحقق</option>
            <option value="delivered" className="bg-[#0c0c14]">تم التسليم</option>
          </select>
        </div>

        {/* ── Deals Table ── */}
        <div className="rounded-2xl border border-white/8 overflow-hidden">
          {dealsLoading ? (
            <div className="py-16 flex flex-col items-center gap-3 text-white/25">
              <Loader2 size={22} className="animate-spin" />
              <p className="text-sm">جارٍ تحميل الصفقات…</p>
            </div>
          ) : dealsError ? (
            <div className="py-12 flex flex-col items-center gap-2 text-red-400">
              <AlertCircle size={20} />
              <p className="text-sm">{dealsError}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/4 border-b border-white/8 text-right" dir="rtl">
                    {["رقم الصفقة","المنتج","السعر","البائع","المشتري","حالة الدفع","حالة الشحن","الأموال",""].map(h => (
                      <th key={h} className="px-4 py-3 text-[10px] font-bold text-white/35 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-white/25">
                          <AlertCircle size={22} />
                          <p className="text-sm">{fullDeals.length === 0 ? "لا توجد صفقات بعد." : "لا توجد صفقات تطابق البحث"}</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((deal, idx) => (
                      <>
                        <motion.tr
                          key={deal.deal_id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: idx * 0.02 }}
                          className={`border-b border-white/6 hover:bg-white/3 transition-colors cursor-pointer ${expanded === deal.deal_id ? "bg-white/3" : ""}`}
                          onClick={() => setExpanded(prev => prev === deal.deal_id ? null : deal.deal_id)}
                          dir="rtl"
                        >
                          {/* Deal ID */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="font-mono text-xs font-bold text-white/60 bg-white/5 border border-white/8 rounded-lg px-2 py-1">
                              {deal.deal_id.slice(0, 8)}…
                            </span>
                          </td>

                          {/* Product */}
                          <td className="px-4 py-3.5 min-w-[160px]">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-lg bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
                                <Package size={11} className="text-white/40" />
                              </div>
                              <span className="text-white/85 font-medium leading-snug line-clamp-1">{deal.product_name}</span>
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-white font-bold">{deal.price.toLocaleString()}</span>
                            <span className="text-white/40 text-xs ms-1">{deal.currency}</span>
                          </td>

                          {/* Seller */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-white/70 text-xs">{userName(deal.seller)}</span>
                          </td>

                          {/* Buyer */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {deal.buyer
                              ? <span className="text-white/70 text-xs">{userName(deal.buyer)}</span>
                              : <span className="text-white/20 text-xs italic">لم يُعيَّن</span>}
                          </td>

                          {/* Pay status */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <Badge cfg={PAY_BADGE[payStatus(deal)]} />
                          </td>

                          {/* Ship status */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <Badge cfg={SHIP_BADGE[shipStatus(deal)]} />
                          </td>

                          {/* Funds released */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {deal.funds_released ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border bg-violet-500/12 text-violet-400 border-violet-500/25">
                                <CheckCircle2 size={9} /> تم
                              </span>
                            ) : (
                              <span className="text-[10px] text-white/20 italic">—</span>
                            )}
                          </td>

                          {/* Expand */}
                          <td className="px-4 py-3.5 text-white/30">
                            {expanded === deal.deal_id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                          </td>
                        </motion.tr>

                        <AnimatePresence>
                          {expanded === deal.deal_id && (
                            <FullDealExpandedRow key={`${deal.deal_id}-exp`} deal={deal} />
                          )}
                        </AnimatePresence>
                      </>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Count */}
        {!dealsLoading && !dealsError && (
          <p className="text-[11px] text-white/25 text-center" dir="rtl">
            {filtered.length} صفقة معروضة من أصل {fullDeals.length}
          </p>
        )}

      </div>
    </AdminLayout>
  );
}
