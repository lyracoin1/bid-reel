/**
 * AuctionMenu — three-dot (⋮) action sheet for auction cards and detail view.
 *
 * Uses React Portal to render backdrop + sheets in document.body, breaking out
 * of any CSS stacking context (transform, overflow:hidden) from parent containers.
 *
 * Actions:
 *  • Delete  — owner only; Arabic confirmation → DELETE /api/auctions/:id
 *  • Share   — navigator.share or clipboard fallback
 *  • Download — fetch media blob → anchor download; opens URL on CORS failure
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Trash2, Share2, Download, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { deleteAuctionApi } from "@/lib/api-client";
import { removeAuctionFromCache } from "@/hooks/use-auctions";
import { toast } from "@/hooks/use-toast";
import { getPublicBaseUrl } from "@/lib/utils";

interface AuctionMenuProps {
  auctionId: string;
  auctionTitle: string;
  mediaUrl: string;
  isOwner: boolean;
  onDeleted?: () => void;
}

type Sheet = "closed" | "menu" | "confirm";

export function AuctionMenu({
  auctionId,
  auctionTitle,
  mediaUrl,
  isOwner,
  onDeleted,
}: AuctionMenuProps) {
  const [sheet, setSheet] = useState<Sheet>("closed");
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sheet === "closed") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet("closed");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sheet]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (sheet === "closed") {
      document.body.style.overflow = "";
    } else {
      document.body.style.overflow = "hidden";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sheet]);

  const handleShare = async () => {
    setSheet("closed");
    const url = `${getPublicBaseUrl()}/auction/${auctionId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: auctionTitle, url });
      } catch (_) {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "تم النسخ", description: "تم نسخ رابط المزاد إلى الحافظة" });
      } catch {
        toast({ title: "تعذّر المشاركة", description: "لم يتمكن من نسخ الرابط", variant: "destructive" });
      }
    }
  };

  const handleDownload = async () => {
    setSheet("closed");
    if (!mediaUrl) {
      toast({ title: "لا يوجد ملف للتنزيل", variant: "destructive" });
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(mediaUrl, { mode: "cors" });
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const ext = blob.type.includes("video") ? "mp4" : blob.type.includes("png") ? "png" : "jpg";
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `auction-${auctionId.slice(0, 8)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast({ title: "تم التنزيل", description: "اكتمل التنزيل بنجاح" });
    } catch {
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
      toast({ title: "فُتح الملف", description: "يمكنك حفظ الملف من المتصفح" });
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAuctionApi(auctionId);
      removeAuctionFromCache(auctionId);
      setSheet("closed");
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

  const portal = (
    <AnimatePresence>
      {sheet !== "closed" && (
        <>
          {/* Backdrop — rendered in body, always above everything */}
          <motion.div
            ref={backdropRef}
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.62)", backdropFilter: "blur(2px)" }}
            onClick={() => setSheet("closed")}
          />

          {/* ── Action menu sheet ── */}
          {sheet === "menu" && (
            <motion.div
              key="menu"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9001, maxWidth: 448, margin: "0 auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[#111] border border-white/10 rounded-t-3xl overflow-hidden">
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

                {/* Title */}
                <div className="px-5 py-3 border-b border-white/8">
                  <p className="text-sm font-bold text-white line-clamp-1 text-right">{auctionTitle}</p>
                </div>

                {/* Actions */}
                <div className="px-3 py-2 space-y-1">

                  {/* Share */}
                  <button
                    onClick={handleShare}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/6 active:bg-white/10 transition-colors text-right"
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
                      <Share2 size={17} className="text-blue-400" />
                    </div>
                    <span className="flex-1 text-sm font-semibold text-white text-right">مشاركة</span>
                  </button>

                  {/* Download */}
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/6 active:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                      {downloading
                        ? <Loader2 size={17} className="text-emerald-400 animate-spin" />
                        : <Download size={17} className="text-emerald-400" />
                      }
                    </div>
                    <span className="flex-1 text-sm font-semibold text-white text-right">
                      {downloading ? "جارٍ التنزيل…" : "تنزيل"}
                    </span>
                  </button>

                  {/* Delete — owner only */}
                  {isOwner && (
                    <button
                      onClick={() => setSheet("confirm")}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-red-500/8 active:bg-red-500/15 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
                        <Trash2 size={17} className="text-red-400" />
                      </div>
                      <span className="flex-1 text-sm font-semibold text-red-400 text-right">حذف</span>
                    </button>
                  )}
                </div>

                {/* Cancel */}
                <div className="px-3 pb-8 pt-2">
                  <button
                    onClick={() => setSheet("closed")}
                    className="w-full py-3.5 rounded-xl bg-white/6 border border-white/8 text-sm font-bold text-white/70 flex items-center justify-center gap-2"
                  >
                    <X size={15} />
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Delete confirmation sheet ── */}
          {sheet === "confirm" && (
            <motion.div
              key="confirm"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9001, maxWidth: 448, margin: "0 auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[#111] border border-white/10 rounded-t-3xl overflow-hidden">
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

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
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* ── Trigger button — stays in component tree ── */}
      <button
        onClick={(e) => { e.stopPropagation(); setSheet("menu"); }}
        className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-md border border-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
        aria-label="خيارات"
      >
        <MoreVertical size={17} />
      </button>

      {/* ── Backdrop + sheets: portaled to document.body ── */}
      {typeof document !== "undefined" && createPortal(portal, document.body)}
    </>
  );
}
