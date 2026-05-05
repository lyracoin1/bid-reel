/**
 * ForgotPasswordModal — email-based password reset via Supabase.
 *
 * Step 1: User enters their email address.
 * Step 2: Supabase sends a recovery link; bilingual success message shown.
 *
 * The user then clicks the link in their email which opens
 * https://www.bid-reel.com/reset-password where they set a new password.
 *
 * WhatsApp is intentionally NOT used in this flow.
 * Seller/auction WhatsApp buttons are unrelated and untouched.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, Mail, CheckCircle2 } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ForgotPasswordModal({ open, onClose }: Props) {
  const { lang, dir } = useLang();
  const isRtl = dir === "rtl";
  const isAr = lang === "ar";

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setLoading(false);
      setError(null);
      setSent(false);
      setTimeout(() => emailRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;

    if (!supabase) {
      setError(isAr ? "خدمة المصادقة غير متاحة." : "Authentication is not configured.");
      return;
    }

    setLoading(true);
    try {
      const { error: sbErr } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: "https://www.bid-reel.com/reset-password",
      });
      if (sbErr) {
        const msg = sbErr.message ?? "";
        if (
          msg === "Failed to fetch" ||
          msg.toLowerCase().includes("network") ||
          msg.toLowerCase().includes("fetch")
        ) {
          setError(isAr ? "خطأ في الشبكة. تحقّق من اتصالك." : "Network error. Check your connection.");
          return;
        }
      }
      // Always show success regardless of whether the email is registered —
      // prevents email-enumeration attacks.
      setSent(true);
    } catch {
      setError(isAr ? "خطأ في الشبكة. تحقّق من اتصالك." : "Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
        onClick={() => { if (!loading) onClose(); }}
      >
        <motion.div
          key="panel"
          dir={dir}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-pw-title"
          className="relative w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-2xl"
        >
          {/* Close */}
          <button
            type="button"
            onClick={() => { if (!loading) onClose(); }}
            aria-label={isAr ? "إغلاق" : "Close"}
            className={`absolute top-3 ${isRtl ? "left-3" : "right-3"} text-muted-foreground hover:text-white transition p-1`}
            disabled={loading}
          >
            <X size={18} />
          </button>

          {/* Header */}
          <div className="flex flex-col items-center gap-2 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              {sent
                ? <CheckCircle2 size={22} className="text-primary" />
                : <Mail size={20} className="text-primary" />}
            </div>
            <h2 id="forgot-pw-title" className="text-lg font-display font-bold text-white text-center">
              {sent
                ? (isAr ? "تم الإرسال" : "Email sent")
                : (isAr ? "إعادة تعيين كلمة المرور" : "Reset password")}
            </h2>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              {sent
                ? (isAr
                    ? "تم إرسال رابط إعادة تعيين كلمة السر. يرجى التحقق من بريدك الإلكتروني."
                    : "Password reset link sent. Please check your email.")
                : (isAr
                    ? "أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين."
                    : "Enter your email and we'll send you a reset link.")}
            </p>
          </div>

          {/* Email form — hidden after sending */}
          {!sent && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}
                >
                  {isAr ? "البريد الإلكتروني" : "Email"}
                </label>
                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null); }}
                  placeholder={isAr ? "example@email.com" : "you@email.com"}
                  autoComplete="email"
                  required
                  dir="ltr"
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    key="err"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`text-sm text-destructive ${isRtl ? "text-right" : "text-left"}`}
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {isAr ? "جارٍ الإرسال…" : "Sending…"}
                  </>
                ) : (
                  isAr ? "إرسال رابط الإعادة" : "Send reset link"
                )}
              </button>
            </form>
          )}

          {/* Success: close CTA */}
          {sent && (
            <button
              type="button"
              onClick={onClose}
              className="w-full mt-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl py-3 transition-colors"
            >
              {isAr ? "العودة لتسجيل الدخول" : "Back to sign in"}
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
