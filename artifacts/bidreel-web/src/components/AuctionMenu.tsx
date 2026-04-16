/**
 * AuctionMenu — three-dot (⋮) action sheet for auction cards.
 *
 * Uses React Portal to render backdrop + sheets in document.body, breaking out
 * of any CSS stacking context (transform, overflow:hidden) from parent containers.
 *
 * OWNER  menu: Delete
 * VIEWER menu: Report · Interested · Not Interested · Mention (mutual follows only)
 *
 * Report flow:  step1 (select reason) → step2 (optional details + submit) → done
 * Mention flow: mutual-follows list with search → tap copies mention text
 *
 * Share and Download have been intentionally removed from this menu.
 * Share lives exclusively on the main reel action stack.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MoreVertical, Trash2, Loader2, X, Flag, AtSign,
  ThumbsUp, ThumbsDown, CheckCircle2, Search, ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  deleteAuctionApi, submitReportApi, getMutualFollowsApi,
  type ApiMutualFollow, type ContentSignal,
} from "@/lib/api-client";
import { removeAuctionFromCache } from "@/hooks/use-auctions";
import { toast } from "@/hooks/use-toast";
import { getPublicBaseUrl } from "@/lib/utils";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AuctionMenuProps {
  auctionId: string;
  auctionTitle: string;
  isOwner: boolean;
  currentSignal?: ContentSignal | null;
  onSignal?: (s: ContentSignal) => void;
  onDeleted?: () => void;
}

// ── Sheet state machine ───────────────────────────────────────────────────────

type Sheet =
  | "closed"
  | "menu"
  | "confirm_delete"
  | "report_step1"
  | "report_step2"
  | "report_done"
  | "mention";

// ── Report reasons (matches backend VALID_REASONS) ────────────────────────────

const REPORT_REASONS: { key: string; label: string }[] = [
  { key: "spam_or_fake",       label: "محتوى مزيف أو مزعج" },
  { key: "offensive_content",  label: "محتوى مسيء أو غير لائق" },
  { key: "fraud_scam",         label: "احتيال أو نصب" },
  { key: "misleading_listing", label: "إعلان مضلل" },
  { key: "other",              label: "أخرى" },
];

// ── Shared animation config ───────────────────────────────────────────────────

const SHEET_SPRING = { type: "spring" as const, damping: 28, stiffness: 320 };
// Sheet wrapper:
//  - position fixed at bottom of viewport (renders into document.body via portal,
//    so no parent overflow / transform / stacking context can clip it).
//  - z-index 9001 sits above any in-page overlay.
//  - max-height 92dvh so the sheet never extends past the visible viewport
//    (which would clip the cancel/submit button on small phones).
const SHEET_STYLE: React.CSSProperties = {
  position: "fixed", bottom: 0, left: 0, right: 0,
  zIndex: 9001, maxWidth: 448, margin: "0 auto",
  maxHeight: "92dvh",
};
// Tailwind classes for the inner panel — adds vertical scroll when content
// exceeds the sheet height, and a safe-area-aware bottom padding so the cancel
// button is never hidden behind the iOS home indicator / Android gesture nav.
const SHEET_INNER_CLASS =
  "bg-[#111] border border-white/10 rounded-t-3xl overflow-y-auto max-h-[92dvh] " +
  "[padding-bottom:env(safe-area-inset-bottom,0px)]";

// ── Main component ────────────────────────────────────────────────────────────

export function AuctionMenu({
  auctionId,
  auctionTitle,
  isOwner,
  currentSignal,
  onSignal,
  onDeleted,
}: AuctionMenuProps) {
  const [sheet, setSheet] = useState<Sheet>("closed");

  // Delete state
  const [deleting, setDeleting] = useState(false);

  // Report state
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);

  // Mention state
  const [mutuals, setMutuals] = useState<ApiMutualFollow[]>([]);
  const [mutualsLoading, setMutualsLoading] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");

  // ── Reset and close ─────────────────────────────────────────────────────────

  const close = useCallback(() => {
    setSheet("closed");
    setReportReason("");
    setReportDetails("");
    setMentionSearch("");
    setAlreadyReported(false);
  }, []);

  // ESC key
  useEffect(() => {
    if (sheet === "closed") return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sheet, close]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = sheet !== "closed" ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sheet]);

  // Fetch mutual follows when mention sheet opens (lazy)
  useEffect(() => {
    if (sheet !== "mention") return;
    setMutualsLoading(true);
    getMutualFollowsApi()
      .then(setMutuals)
      .catch(() => setMutuals([]))
      .finally(() => setMutualsLoading(false));
  }, [sheet]);

  // Auto-close report_done after 2 s
  useEffect(() => {
    if (sheet !== "report_done") return;
    const t = setTimeout(() => close(), 2000);
    return () => clearTimeout(t);
  }, [sheet, close]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAuctionApi(auctionId);
      removeAuctionFromCache(auctionId);
      close();
      toast({ title: "تم الحذف", description: "تم حذف المزاد بنجاح" });
      onDeleted?.();
    } catch (err: unknown) {
      toast({
        title: "فشل الحذف",
        description: err instanceof Error ? err.message : "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleReportSubmit = async () => {
    if (!reportReason || submitting) return;
    setSubmitting(true);
    try {
      await submitReportApi({
        auctionId,
        reason: reportReason,
        details: reportDetails.trim() || undefined,
      });
      setSheet("report_done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("already")) {
        setAlreadyReported(true);
        setSheet("report_done");
      } else {
        toast({
          title: "فشل الإبلاغ",
          description: msg || "حدث خطأ غير متوقع",
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleMention = async (user: ApiMutualFollow) => {
    const handle = user.username ? `@${user.username}` : (user.display_name ?? "مستخدم");
    const url = `${getPublicBaseUrl()}/auction/${auctionId}`;
    const text = `${handle} شاهد هذا المزاد: ${url}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "تم النسخ", description: `تم نسخ الإشارة إلى ${handle}` });
    } catch {
      toast({ title: "تعذّر النسخ", variant: "destructive" });
    }
    close();
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredMutuals = mutuals.filter(u => {
    const q = mentionSearch.toLowerCase();
    if (!q) return true;
    return (
      (u.username ?? "").toLowerCase().includes(q) ||
      (u.display_name ?? "").toLowerCase().includes(q)
    );
  });

  // ── Portal content ──────────────────────────────────────────────────────────

  const portal = (
    <AnimatePresence>
      {sheet !== "closed" && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.62)", backdropFilter: "blur(2px)" }}
            onClick={close}
          />

          {/* ── MAIN MENU ─────────────────────────────────────────────────── */}
          {sheet === "menu" && (
            <motion.div
              key="menu"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_SPRING} style={SHEET_STYLE}
              onClick={e => e.stopPropagation()}
            >
              <div className={SHEET_INNER_CLASS}>
                <Handle />
                <div className="px-5 py-3 border-b border-white/[0.08]">
                  <p className="text-sm font-bold text-white line-clamp-1 text-right">{auctionTitle}</p>
                </div>

                <div className="px-3 py-2 space-y-1">
                  {isOwner ? (
                    /* ── OWNER: Delete only ── */
                    <ActionRow
                      icon={<Trash2 size={17} className="text-red-400" />}
                      iconBg="bg-red-500/15 border-red-500/25"
                      label="حذف المزاد"
                      labelClass="text-red-400"
                      rowClass="hover:bg-red-500/8 active:bg-red-500/15"
                      onClick={() => setSheet("confirm_delete")}
                    />
                  ) : (
                    /* ── VIEWER: Report · Interested · Not Interested · Mention ── */
                    <>
                      <ActionRow
                        icon={<Flag size={17} className="text-orange-400" />}
                        iconBg="bg-orange-500/15 border-orange-500/25"
                        label="الإبلاغ عن المزاد"
                        chevron
                        onClick={() => setSheet("report_step1")}
                      />
                      <ActionRow
                        icon={
                          <ThumbsUp
                            size={17}
                            className={currentSignal === "interested" ? "text-emerald-300" : "text-emerald-400"}
                          />
                        }
                        iconBg={
                          currentSignal === "interested"
                            ? "bg-emerald-400/25 border-emerald-400/40"
                            : "bg-emerald-500/15 border-emerald-500/25"
                        }
                        label="مهتم"
                        badge={currentSignal === "interested" ? <ActiveDot color="emerald" /> : undefined}
                        onClick={() => { onSignal?.("interested"); close(); }}
                      />
                      <ActionRow
                        icon={
                          <ThumbsDown
                            size={17}
                            className={currentSignal === "not_interested" ? "text-rose-300" : "text-rose-400"}
                          />
                        }
                        iconBg={
                          currentSignal === "not_interested"
                            ? "bg-rose-400/25 border-rose-400/40"
                            : "bg-rose-500/15 border-rose-500/25"
                        }
                        label="غير مهتم"
                        badge={currentSignal === "not_interested" ? <ActiveDot color="rose" /> : undefined}
                        onClick={() => { onSignal?.("not_interested"); close(); }}
                      />
                      <ActionRow
                        icon={<AtSign size={17} className="text-violet-400" />}
                        iconBg="bg-violet-500/15 border-violet-500/25"
                        label="الإشارة إلى صديق"
                        chevron
                        onClick={() => setSheet("mention")}
                      />
                    </>
                  )}
                </div>

                <CancelRow onClose={close} />
              </div>
            </motion.div>
          )}

          {/* ── DELETE CONFIRM ─────────────────────────────────────────────── */}
          {sheet === "confirm_delete" && (
            <motion.div
              key="confirm"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_SPRING} style={SHEET_STYLE}
              onClick={e => e.stopPropagation()}
            >
              <div className={SHEET_INNER_CLASS}>
                <Handle />
                <div className="px-5 pt-4 pb-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center mx-auto mb-4">
                    <Trash2 size={24} className="text-red-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">حذف المزاد؟</h3>
                  <p className="text-sm text-white/50 leading-relaxed mb-6">
                    هل أنت متأكد من حذف هذا المزاد؟ لا يمكن التراجع عن هذا الإجراء.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSheet("menu")}
                      disabled={deleting}
                      className="flex-1 py-3.5 rounded-xl bg-white/6 border border-white/8 text-sm font-bold text-white/70"
                    >
                      إلغاء
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 py-3.5 rounded-xl bg-red-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      {deleting ? "جارٍ الحذف…" : "تأكيد الحذف"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── REPORT STEP 1: Select reason ───────────────────────────────── */}
          {sheet === "report_step1" && (
            <motion.div
              key="report1"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_SPRING} style={SHEET_STYLE}
              onClick={e => e.stopPropagation()}
            >
              <div className={SHEET_INNER_CLASS}>
                <Handle />
                <div className="px-5 py-3 border-b border-white/[0.08] flex items-center gap-3">
                  <button
                    onClick={() => setSheet("menu")}
                    className="w-8 h-8 rounded-full bg-white/6 flex items-center justify-center shrink-0"
                  >
                    <ChevronRight size={14} className="text-white/60" />
                  </button>
                  <p className="flex-1 text-sm font-bold text-white text-right">سبب الإبلاغ</p>
                </div>
                <div className="px-3 py-2 space-y-0.5">
                  {REPORT_REASONS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => { setReportReason(key); setSheet("report_step2"); }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/6 active:bg-white/10 transition-colors"
                    >
                      <span className="flex-1 text-sm font-medium text-white text-right">{label}</span>
                      <ChevronRight size={14} className="text-white/30 shrink-0 rotate-180" />
                    </button>
                  ))}
                </div>
                <CancelRow onClose={close} />
              </div>
            </motion.div>
          )}

          {/* ── REPORT STEP 2: Optional details + submit ───────────────────── */}
          {sheet === "report_step2" && (
            <motion.div
              key="report2"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_SPRING} style={SHEET_STYLE}
              onClick={e => e.stopPropagation()}
            >
              <div className={SHEET_INNER_CLASS}>
                <Handle />
                <div className="px-5 py-3 border-b border-white/[0.08] flex items-center gap-3">
                  <button
                    onClick={() => setSheet("report_step1")}
                    className="w-8 h-8 rounded-full bg-white/6 flex items-center justify-center shrink-0"
                  >
                    <ChevronRight size={14} className="text-white/60" />
                  </button>
                  <p className="flex-1 text-sm font-bold text-white text-right">
                    {REPORT_REASONS.find(r => r.key === reportReason)?.label}
                  </p>
                </div>
                <div className="px-4 py-4">
                  <p className="text-xs text-white/40 mb-2 text-right">تفاصيل إضافية (اختياري)</p>
                  <textarea
                    dir="rtl"
                    value={reportDetails}
                    onChange={e => setReportDetails(e.target.value.slice(0, 500))}
                    placeholder="أضف تفاصيل إضافية…"
                    rows={4}
                    className="w-full bg-white/6 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 resize-none outline-none focus:border-white/20 text-right"
                  />
                  <p className="text-xs text-white/25 text-left mt-1">{reportDetails.length}/500</p>
                </div>
                <div className="px-4 pb-8 pt-1">
                  <button
                    onClick={handleReportSubmit}
                    disabled={submitting}
                    className="w-full py-3.5 rounded-xl bg-orange-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Flag size={15} />}
                    {submitting ? "جارٍ الإرسال…" : "إرسال الإبلاغ"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── REPORT DONE ────────────────────────────────────────────────── */}
          {sheet === "report_done" && (
            <motion.div
              key="report_done"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_SPRING} style={SHEET_STYLE}
              onClick={e => e.stopPropagation()}
            >
              <div className={SHEET_INNER_CLASS}>
                <Handle />
                <div className="px-5 pt-6 pb-10 text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={28} className="text-emerald-400" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">
                    {alreadyReported ? "تم إبلاغك سابقاً" : "تم استلام بلاغك"}
                  </h3>
                  <p className="text-sm text-white/50 leading-relaxed">
                    {alreadyReported
                      ? "لقد قدّمت بلاغاً على هذا المزاد من قبل. يتم مراجعته من قِبل فريقنا."
                      : "شكراً لك. سيراجع فريقنا هذا المزاد ويتخذ الإجراء المناسب."}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── MENTION SHEET ──────────────────────────────────────────────── */}
          {sheet === "mention" && (
            <motion.div
              key="mention"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SHEET_SPRING} style={SHEET_STYLE}
              onClick={e => e.stopPropagation()}
            >
              <div
                className={SHEET_INNER_CLASS + " flex flex-col"}
              >
                <Handle />
                <div className="px-5 py-3 border-b border-white/[0.08] flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setSheet("menu")}
                    className="w-8 h-8 rounded-full bg-white/6 flex items-center justify-center shrink-0"
                  >
                    <X size={14} className="text-white/60" />
                  </button>
                  <p className="flex-1 text-sm font-bold text-white text-right">الإشارة إلى صديق</p>
                </div>

                {/* Search bar */}
                <div className="px-4 py-3 shrink-0">
                  <div className="flex items-center gap-2 bg-white/6 border border-white/10 rounded-xl px-3 py-2.5">
                    <Search size={14} className="text-white/30 shrink-0" />
                    <input
                      dir="rtl"
                      value={mentionSearch}
                      onChange={e => setMentionSearch(e.target.value)}
                      placeholder="بحث…"
                      className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none text-right"
                    />
                  </div>
                </div>

                {/* User list */}
                <div className="overflow-y-auto flex-1 px-3 pb-8">
                  {mutualsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 size={22} className="text-white/30 animate-spin" />
                    </div>
                  ) : filteredMutuals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                      <AtSign size={32} className="text-white/15 mb-3" />
                      <p className="text-sm font-medium text-white/40">
                        {mentionSearch
                          ? "لا توجد نتائج مطابقة"
                          : "يمكنك الإشارة فقط إلى المستخدمين الذين يتابعونك وتتابعهم"}
                      </p>
                    </div>
                  ) : (
                    filteredMutuals.map(user => (
                      <button
                        key={user.id}
                        onClick={() => handleMention(user)}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/6 active:bg-white/10 transition-colors text-right"
                      >
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover shrink-0 bg-white/10"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-white/10 shrink-0 flex items-center justify-center">
                            <span className="text-xs font-bold text-white/40">
                              {(user.display_name ?? user.username ?? "?").charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0 text-right">
                          <p className="text-sm font-semibold text-white truncate">
                            {user.display_name ?? user.username}
                          </p>
                          {user.username && (
                            <p className="text-xs text-white/40">@{user.username}</p>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* ── Trigger button ── */}
      <button
        onClick={e => { e.stopPropagation(); setSheet("menu"); }}
        className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-md border border-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
        aria-label="خيارات"
      >
        <MoreVertical size={17} />
      </button>

      {typeof document !== "undefined" && createPortal(portal, document.body)}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Handle() {
  return (
    <div className="flex justify-center pt-3 pb-1">
      <div className="w-10 h-1 rounded-full bg-white/20" />
    </div>
  );
}

function CancelRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-3 pb-8 pt-2">
      <button
        onClick={onClose}
        className="w-full py-3.5 rounded-xl bg-white/6 border border-white/8 text-sm font-bold text-white/70 flex items-center justify-center gap-2"
      >
        <X size={15} />
        إلغاء
      </button>
    </div>
  );
}

function ActiveDot({ color }: { color: "emerald" | "rose" }) {
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${color === "rose" ? "bg-rose-400" : "bg-emerald-400"}`}
    />
  );
}

interface ActionRowProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  labelClass?: string;
  rowClass?: string;
  badge?: React.ReactNode;
  chevron?: boolean;
  onClick: () => void;
}

function ActionRow({
  icon, iconBg, label, labelClass, rowClass, badge, chevron, onClick,
}: ActionRowProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/6 active:bg-white/10 transition-colors ${rowClass ?? ""}`}
    >
      <div className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <span className={`flex-1 text-sm font-semibold text-right ${labelClass ?? "text-white"}`}>
        {label}
      </span>
      {badge}
      {chevron && <ChevronRight size={14} className="text-white/30 shrink-0 rotate-180" />}
    </button>
  );
}
