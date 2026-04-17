import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle2, Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";

export default function ChangePassword() {
  const [, setLocation] = useLocation();
  const { t, dir } = useLang();
  const isRtl = dir === "rtl";

  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [showNew, setShowNew]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState(false);
  const [loading, setLoading]       = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError("Authentication is not configured.");
      return;
    }

    if (!newPw || !confirmPw) return;

    if (newPw.length < 8) {
      setError(t("change_pw_too_short"));
      return;
    }

    if (newPw !== confirmPw) {
      setError(t("change_pw_mismatch"));
      return;
    }

    setLoading(true);
    try {
      // Confirm an authenticated session exists. Supabase's updateUser()
      // uses the current access token — no current-password re-auth required.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError(t("change_pw_no_email_auth"));
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div dir={dir} className="relative w-full min-h-[100dvh] bg-background flex flex-col items-center justify-center px-6">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px]" />
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5 text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t("change_pw_success")}</h1>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setLocation("/profile")}
            className="mt-2 px-8 py-3.5 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/30"
          >
            {t("continue")}
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div dir={dir} className="relative w-full min-h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/10 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center gap-4 px-5 pt-14 pb-5 border-b border-white/6">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => setLocation("/profile")}
          className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white/60 hover:text-white shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </motion.button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center">
            <Lock size={16} className="text-white/60" />
          </div>
          <h1 className="text-base font-bold text-white">{t("change_pw_title")}</h1>
        </div>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex flex-col gap-5 px-5 pt-8 pb-12"
      >
        {/* New password */}
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-semibold text-white/50 uppercase tracking-wide ${isRtl ? "text-right" : "text-left"}`}>
            {t("new_password")}
          </label>
          <div className="relative">
            <Lock size={15} className={`absolute top-1/2 -translate-y-1/2 text-white/30 pointer-events-none ${isRtl ? "left-10" : "right-10"}`} />
            <button
              type="button"
              onClick={() => setShowNew(v => !v)}
              className={`absolute top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition ${isRtl ? "left-3.5" : "right-3.5"}`}
              tabIndex={-1}
            >
              {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <input
              type={showNew ? "text" : "password"}
              value={newPw}
              onChange={e => { setNewPw(e.target.value); setError(null); }}
              autoComplete="new-password"
              required
              dir="ltr"
              className={`w-full bg-white/5 border border-white/10 focus:border-primary/60 rounded-2xl px-4 py-4 text-white text-base placeholder:text-white/20 focus:outline-none transition-colors ${isRtl ? "pl-20" : "pr-20"}`}
            />
          </div>
          <p className={`text-xs text-white/30 mt-0.5 ${isRtl ? "text-right" : "text-left"}`}>
            {t("change_pw_too_short")}
          </p>
        </div>

        {/* Confirm new password */}
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-semibold text-white/50 uppercase tracking-wide ${isRtl ? "text-right" : "text-left"}`}>
            {t("confirm_new_password")}
          </label>
          <div className="relative">
            <Lock size={15} className={`absolute top-1/2 -translate-y-1/2 text-white/30 pointer-events-none ${isRtl ? "left-10" : "right-10"}`} />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className={`absolute top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition ${isRtl ? "left-3.5" : "right-3.5"}`}
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPw}
              onChange={e => { setConfirmPw(e.target.value); setError(null); }}
              autoComplete="new-password"
              required
              dir="ltr"
              className={`w-full bg-white/5 border border-white/10 focus:border-primary/60 rounded-2xl px-4 py-4 text-white text-base placeholder:text-white/20 focus:outline-none transition-colors ${isRtl ? "pl-20" : "pr-20"}`}
            />
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 rounded-xl bg-red-500/10 border border-red-500/20"
            >
              <p className={`text-sm text-red-400 ${isRtl ? "text-right" : "text-left"}`}>{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <motion.button
          type="submit"
          whileTap={{ scale: 0.97 }}
          disabled={loading || !newPw || !confirmPw}
          className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 transition-opacity"
        >
          {loading ? (
            <><Loader2 size={18} className="animate-spin" /> {t("processing")}</>
          ) : (
            t("change_pw_submit")
          )}
        </motion.button>
      </form>
    </div>
  );
}
