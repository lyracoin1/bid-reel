import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Package, DollarSign, Clock, CheckCircle2,
  Truck, Upload, Link2, ChevronDown, ChevronUp, X,
  AlertCircle, FileText, Search,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";

// ── Types ────────────────────────────────────────────────────────────────────

type PayStatus     = "awaiting" | "secured";
type ShipStatus    = "pending"  | "verified" | "delivered";

interface SecureDeal {
  id:           string;
  product:      string;
  price:        number;
  currency:     string;
  buyerName:    string;
  sellerName:   string;
  payStatus:    PayStatus;
  shipStatus:   ShipStatus;
  trackingLink: string;
  docFileName:  string | null;
  createdAt:    string;
}

// ── Placeholder seed data ─────────────────────────────────────────────────────

const INITIAL_DEALS: SecureDeal[] = [
  { id: "BD-A1B2C3", product: "Authentic Rolex Submariner",    price: 2800,  currency: "USD", buyerName: "Ahmed Al-Rashid",   sellerName: "Khalid Nasser",   payStatus: "secured",  shipStatus: "verified",   trackingLink: "https://track.dhl.com/BD-A1B2C3", docFileName: "dhl_receipt_A1B2C3.pdf", createdAt: "2026-04-28" },
  { id: "BD-D4E5F6", product: "iPhone 15 Pro Max 256GB",       price: 1200,  currency: "USD", buyerName: "Sara Mahmoud",      sellerName: "Omar Khalil",     payStatus: "secured",  shipStatus: "pending",    trackingLink: "",                                docFileName: null,                     createdAt: "2026-04-30" },
  { id: "BD-G7H8I9", product: "Vintage Camera Collection",     price: 450,   currency: "EUR", buyerName: "Tariq Yusuf",       sellerName: "Layla Hassan",    payStatus: "awaiting", shipStatus: "pending",    trackingLink: "",                                docFileName: null,                     createdAt: "2026-05-01" },
  { id: "BD-J0K1L2", product: "MacBook Pro M3 14-inch",        price: 1950,  currency: "USD", buyerName: "Nora Al-Amri",      sellerName: "Faisal Ibrahim",  payStatus: "secured",  shipStatus: "delivered",  trackingLink: "https://track.fedex.com/J0K1L2",  docFileName: "fedex_J0K1L2.pdf",       createdAt: "2026-04-25" },
  { id: "BD-M3N4O5", product: "Original Chanel Handbag",       price: 3200,  currency: "USD", buyerName: "Hana Al-Zahrani",   sellerName: "Reem Qasim",      payStatus: "awaiting", shipStatus: "pending",    trackingLink: "",                                docFileName: null,                     createdAt: "2026-05-02" },
  { id: "BD-P6Q7R8", product: "PS5 + 3 Controllers Bundle",    price: 680,   currency: "USD", buyerName: "Jassim Al-Dosari",  sellerName: "Mona Saleh",      payStatus: "secured",  shipStatus: "verified",   trackingLink: "https://track.ups.com/P6Q7R8",    docFileName: "ups_P6Q7R8.pdf",         createdAt: "2026-04-29" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAY_BADGE: Record<PayStatus, { label: string; cls: string }> = {
  awaiting: { label: "بانتظار الدفع",    cls: "bg-amber-500/12 text-amber-400 border-amber-500/25" },
  secured:  { label: "تم تأمين الدفع",   cls: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25" },
};
const SHIP_BADGE: Record<ShipStatus, { label: string; cls: string }> = {
  pending:   { label: "قيد الانتظار",   cls: "bg-gray-500/12 text-gray-400 border-gray-500/20" },
  verified:  { label: "تم التحقق",      cls: "bg-blue-500/12 text-blue-400 border-blue-500/25" },
  delivered: { label: "تم التسليم",     cls: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25" },
};

function Badge({ cfg }: { cfg: { label: string; cls: string } }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Expanded row ──────────────────────────────────────────────────────────────

function DealExpandedRow({
  deal,
  onVerify,
  onTrackingChange,
  onDocUpload,
}: {
  deal: SecureDeal;
  onVerify: (id: string) => void;
  onTrackingChange: (id: string, val: string) => void;
  onDocUpload: (id: string, fileName: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log("[SecureDeals Admin] Shipping doc uploaded (placeholder):", file.name, "for deal:", deal.id);
    onDocUpload(deal.id, file.name);
    if (deal.shipStatus === "pending") onVerify(deal.id);
  }

  function handleTrackingSave() {
    if (!deal.trackingLink.trim()) return;
    console.log("[SecureDeals Admin] Tracking link saved (placeholder):", deal.trackingLink, "for deal:", deal.id);
    if (deal.shipStatus === "pending") onVerify(deal.id);
  }

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <td colSpan={7} className="bg-white/2 border-b border-white/6 px-5 py-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-3xl" dir="rtl">

          {/* Buyer / Seller info */}
          <div className="rounded-xl bg-white/3 border border-white/8 px-4 py-3 space-y-1.5 text-sm">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">تفاصيل الأطراف</p>
            <div className="flex justify-between text-white/60">
              <span className="text-white/35">البائع</span>
              <span className="font-medium text-white/80">{deal.sellerName}</span>
            </div>
            <div className="flex justify-between text-white/60">
              <span className="text-white/35">المشتري</span>
              <span className="font-medium text-white/80">{deal.buyerName}</span>
            </div>
            <div className="flex justify-between text-white/60">
              <span className="text-white/35">تاريخ الإنشاء</span>
              <span className="font-medium text-white/80">{deal.createdAt}</span>
            </div>
          </div>

          {/* Shipment verification */}
          <div className="rounded-xl bg-white/3 border border-white/8 px-4 py-3 space-y-3">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">التحقق من الشحن</p>

            {/* Tracking link */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/40">رابط التتبع (DHL / FedEx / UPS)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
                  <input
                    type="url"
                    value={deal.trackingLink}
                    onChange={e => onTrackingChange(deal.id, e.target.value)}
                    placeholder="https://track.dhl.com/..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg pr-8 pl-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-primary/40 transition"
                    dir="ltr"
                  />
                </div>
                <button
                  onClick={handleTrackingSave}
                  disabled={!deal.trackingLink.trim()}
                  className="px-3 py-2 rounded-lg bg-blue-600/80 text-white text-xs font-bold hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  حفظ
                </button>
              </div>
            </div>

            {/* Doc upload */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/40">وثيقة الشحن (PDF / صورة)</label>
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFile} />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/6 border border-white/10 text-white/60 text-xs font-medium hover:bg-white/10 hover:text-white/80 transition"
                >
                  <Upload size={12} />
                  {deal.docFileName ? "تغيير الوثيقة" : "رفع الوثيقة"}
                </button>
                {deal.docFileName && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                    <FileText size={11} />
                    <span className="truncate max-w-[140px]">{deal.docFileName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Verify button */}
            {deal.shipStatus === "pending" && (
              <button
                onClick={() => onVerify(deal.id)}
                className="w-full py-2.5 rounded-lg bg-emerald-600/80 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:brightness-110 transition"
              >
                <CheckCircle2 size={13} />
                تأكيد التحقق من الشحن
              </button>
            )}
            {deal.shipStatus !== "pending" && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 size={13} />
                {deal.shipStatus === "delivered" ? "تم التسليم والتأكيد" : "تم التحقق من الشحن"}
              </div>
            )}
          </div>
        </div>
      </td>
    </motion.tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecureDeals() {
  const [deals, setDeals] = useState<SecureDeal[]>(INITIAL_DEALS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterPay, setFilterPay] = useState<PayStatus | "all">("all");
  const [filterShip, setFilterShip] = useState<ShipStatus | "all">("all");

  const filtered = deals.filter(d => {
    const q = search.toLowerCase();
    const matchQ = !q || d.id.toLowerCase().includes(q) || d.product.toLowerCase().includes(q) || d.buyerName.toLowerCase().includes(q) || d.sellerName.toLowerCase().includes(q);
    const matchPay  = filterPay  === "all" || d.payStatus  === filterPay;
    const matchShip = filterShip === "all" || d.shipStatus === filterShip;
    return matchQ && matchPay && matchShip;
  });

  function toggleExpand(id: string) {
    setExpanded(prev => prev === id ? null : id);
  }

  function verifyShipment(id: string) {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, shipStatus: "verified" as ShipStatus } : d));
    console.log("[SecureDeals Admin] Shipment verified (placeholder) for:", id);
  }

  function updateTracking(id: string, val: string) {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, trackingLink: val } : d));
  }

  function uploadDoc(id: string, fileName: string) {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, docFileName: fileName } : d));
  }

  const summaryStats = {
    total:    deals.length,
    secured:  deals.filter(d => d.payStatus === "secured").length,
    pending:  deals.filter(d => d.shipStatus === "pending").length,
    verified: deals.filter(d => d.shipStatus === "verified").length,
  };

  return (
    <AdminLayout title="الصفقات الآمنة">
      <div className="space-y-5 max-w-7xl">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
            <ShieldCheck size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white" dir="rtl">الصفقات الآمنة</h1>
            <p className="text-[11px] text-white/35" dir="rtl">إدارة ومتابعة الصفقات المحمية</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" dir="rtl">
          {[
            { label: "إجمالي الصفقات",   value: summaryStats.total,    icon: <ShieldCheck size={16} />, cls: "text-white/60  bg-white/5   border-white/10" },
            { label: "مدفوعات مؤمّنة",   value: summaryStats.secured,  icon: <DollarSign  size={16} />, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
            { label: "شحن معلّق",         value: summaryStats.pending,  icon: <Clock       size={16} />, cls: "text-amber-400  bg-amber-500/10  border-amber-500/20" },
            { label: "تم التحقق",         value: summaryStats.verified, icon: <Truck       size={16} />, cls: "text-blue-400   bg-blue-500/10   border-blue-500/20" },
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

        {/* Filters + Search */}
        <div className="flex flex-wrap items-center gap-2.5" dir="rtl">
          {/* Search */}
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

          {/* Pay filter */}
          <select
            value={filterPay}
            onChange={e => setFilterPay(e.target.value as PayStatus | "all")}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-primary/40 transition cursor-pointer"
            dir="rtl"
          >
            <option value="all" className="bg-[#0c0c14]">كل حالات الدفع</option>
            <option value="awaiting" className="bg-[#0c0c14]">بانتظار الدفع</option>
            <option value="secured"  className="bg-[#0c0c14]">تم تأمين الدفع</option>
          </select>

          {/* Ship filter */}
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

        {/* Table */}
        <div className="rounded-2xl border border-white/8 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/4 border-b border-white/8 text-right" dir="rtl">
                  {["رقم الصفقة", "المنتج", "السعر", "حالة الدفع", "حالة الشحن", "التتبع / الوثيقة", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-bold text-white/35 uppercase tracking-widest whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-white/25">
                        <AlertCircle size={22} />
                        <p className="text-sm">لا توجد صفقات تطابق البحث</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((deal, idx) => (
                    <>
                      <motion.tr
                        key={deal.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: idx * 0.03 }}
                        className={`border-b border-white/6 hover:bg-white/3 transition-colors cursor-pointer ${expanded === deal.id ? "bg-white/3" : ""}`}
                        onClick={() => toggleExpand(deal.id)}
                        dir="rtl"
                      >
                        {/* Deal ID */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="font-mono text-xs font-bold text-white/60 bg-white/5 border border-white/8 rounded-lg px-2 py-1">
                            {deal.id}
                          </span>
                        </td>

                        {/* Product */}
                        <td className="px-4 py-3.5 min-w-[180px]">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
                              <Package size={11} className="text-white/40" />
                            </div>
                            <span className="text-white/85 font-medium leading-snug line-clamp-1">{deal.product}</span>
                          </div>
                        </td>

                        {/* Price */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-white font-bold">{deal.price.toLocaleString()}</span>
                          <span className="text-white/40 text-xs ms-1">{deal.currency}</span>
                        </td>

                        {/* Pay status */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <Badge cfg={PAY_BADGE[deal.payStatus]} />
                        </td>

                        {/* Ship status */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <Badge cfg={SHIP_BADGE[deal.shipStatus]} />
                        </td>

                        {/* Tracking / doc */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {deal.trackingLink ? (
                            <a
                              href={deal.trackingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition"
                            >
                              <Link2 size={11} />
                              تتبع الشحنة
                            </a>
                          ) : deal.docFileName ? (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                              <FileText size={11} />
                              <span className="truncate max-w-[100px]">{deal.docFileName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-white/20 italic">لا يوجد</span>
                          )}
                        </td>

                        {/* Expand toggle */}
                        <td className="px-4 py-3.5 text-white/30">
                          {expanded === deal.id
                            ? <ChevronUp size={15} />
                            : <ChevronDown size={15} />
                          }
                        </td>
                      </motion.tr>

                      <AnimatePresence>
                        {expanded === deal.id && (
                          <DealExpandedRow
                            key={`${deal.id}-exp`}
                            deal={deal}
                            onVerify={verifyShipment}
                            onTrackingChange={updateTracking}
                            onDocUpload={uploadDoc}
                          />
                        )}
                      </AnimatePresence>
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Count */}
        <p className="text-[11px] text-white/25 text-center" dir="rtl">
          {filtered.length} صفقة من أصل {deals.length}
        </p>

      </div>
    </AdminLayout>
  );
}
