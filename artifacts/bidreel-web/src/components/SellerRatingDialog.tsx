import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ThumbsUp, ThumbsDown, Check, Loader2 } from "lucide-react";
import { submitSellerRatingApi, type SellerRatingInput } from "@/lib/api-client";
import { useLang } from "@/contexts/LanguageContext";

interface SellerRatingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dealId: string;
  ratedUserId: string;
  onSubmitted?: () => void;
}

const POSITIVE_TAGS = ["سريع", "مهذب", "موثوق", "صبور", "سعر جيد"];
const NEGATIVE_TAGS = ["بطيء", "غير مهذب", "غير موثوق", "غير صبور", "سعر سيء"];

export function SellerRatingDialog({ isOpen, onClose, dealId, ratedUserId, onSubmitted }: SellerRatingDialogProps) {
  const { lang } = useLang();
  const [ratingType, setRatingType] = useState<"positive" | "negative">("positive");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = ratingType === "positive" ? POSITIVE_TAGS : NEGATIVE_TAGS;

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleRatingTypeChange = (type: "positive" | "negative") => {
    setRatingType(type);
    setSelectedTags([]); // Clear tags when switching type
  };

  const onSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const payload: SellerRatingInput = {
      dealId,
      ratedUserId,
      ratingType,
      tags: selectedTags,
      comment: comment.trim() || undefined,
      isAnonymous,
    };

    try {
      await submitSellerRatingApi(payload);
      
      // Localized toast message (simulated with alert or handled by caller)
      const successMsg = lang === "ar" ? "تم إرسال تقييمك" : "Your rating was submitted";
      console.log(successMsg); // In a real app, use a toast library
      
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      if (err.message === "RATING_ALREADY_EXISTS") {
        setError(lang === "ar" ? "لقد قيّمت هذه الصفقة مسبقاً" : "You already rated this deal");
      } else {
        setError(lang === "ar" ? "فشل إرسال التقييم" : "Failed to submit rating");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-lg bg-[#121212] border-t sm:border border-white/10 rounded-t-[32px] sm:rounded-[32px] overflow-hidden shadow-2xl"
          >
            <div className="px-6 pt-8 pb-10">
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold text-white text-right w-full pr-2">
                  كيف كانت تجربتك مع هذا البائع؟
                </h2>
                <button
                  onClick={onClose}
                  className="absolute left-6 top-8 w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
                  {error}
                </div>
              )}

              {/* Positive/Negative Toggle */}
              <div className="flex p-1 bg-white/5 border border-white/8 rounded-2xl mb-8">
                <button
                  onClick={() => handleRatingTypeChange("positive")}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
                    ratingType === "positive"
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  <ThumbsUp size={18} />
                  <span>إيجابي</span>
                </button>
                <button
                  onClick={() => handleRatingTypeChange("negative")}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
                    ratingType === "negative"
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  <ThumbsDown size={18} />
                  <span>سلبي</span>
                </button>
              </div>

              {/* Multi-select Chips */}
              <div className="flex flex-wrap gap-2 mb-8 justify-end" dir="rtl">
                {tags.map(tag => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        isSelected
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-white/5 border-white/10 text-white/60 hover:border-white/20"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>

              {/* Textarea */}
              <div className="mb-6">
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="أضف تعليقاً إضافياً (اختياري)..."
                  dir="rtl"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder-white/20 outline-none focus:border-primary/50 transition-colors resize-none h-28"
                />
              </div>

              {/* Anonymous Checkbox */}
              <label className="flex items-center justify-end gap-3 mb-8 cursor-pointer group">
                <span className="text-sm text-white/60 group-hover:text-white/80 transition-colors">اجعل تقييمي مجهولاً</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={e => setIsAnonymous(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${
                    isAnonymous ? "bg-primary border-primary" : "bg-transparent border-white/20"
                  }`}>
                    {isAnonymous && <Check size={14} className="text-white" />}
                  </div>
                </div>
              </label>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  onClick={onSubmit}
                  disabled={isSubmitting}
                  className="flex-1 py-4 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/30 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 size={18} className="animate-spin" />}
                  إرسال التقييم
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
