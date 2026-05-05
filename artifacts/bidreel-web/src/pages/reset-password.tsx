/**
 * /reset-password
 *
 * Landing page for Supabase password-recovery email links.
 *
 * Flow:
 *   1. User taps "Forgot password?" on login → enters email → Supabase sends link.
 *   2. Link opens https://www.bid-reel.com/reset-password?code=... (PKCE) or
 *      https://www.bid-reel.com/reset-password#access_token=...&type=recovery
 *   3. Supabase JS client (detectSessionInUrl: true) automatically exchanges
 *      the code/token for a session.
 *   4. ⚠ PKCE recovery bug in Supabase auth-js: when the flow type is PKCE,
 *      _getSessionFromURL returns redirectType=null, so _initialize() fires
 *      SIGNED_IN instead of PASSWORD_RECOVERY (see GoTrueClient.js).
 *      This page therefore handles SIGNED_IN and INITIAL_SESSION in addition
 *      to PASSWORD_RECOVERY, using the module-level URL snapshot to confirm
 *      this load was triggered by a recovery link.
 *   5. On submit: supabase.auth.updateUser({ password }) → success → /login.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";

// ── Module-level URL snapshot ─────────────────────────────────────────────────
// Captured synchronously at module evaluation time, before Supabase's async
// _initialize() can call history.replaceState and strip the ?code= parameter.
// This is the only reliable way to detect a PKCE recovery link after the fact.
const _initialSearch = typeof window !== "undefined" ? window.location.search : "";
const _initialHash   = typeof window !== "undefined" ? window.location.hash   : "";

// True when this page load was opened via a Supabase password-recovery link.
// Covers both flows:
//   • PKCE (default in Supabase v2): ?code=<single-use code>
//   • Implicit (legacy):             #access_token=...&type=recovery
const _isRecoveryPageLoad =
  _initialSearch.includes("code=")         ||  // PKCE recovery / magic-link
  _initialHash.includes("type=recovery")   ||  // implicit recovery token (hash)
  _initialSearch.includes("type=recovery");    // implicit recovery token (query)

type PageState = "waiting" | "form" | "success" | "invalid";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { dir } = useLang();
  const isRtl = dir === "rtl";

  // Detect language from stored preference instead of hook to avoid
  // importing the full i18n catalog just for this small page.
  const isAr = typeof document !== "undefined"
    ? document.documentElement.lang === "ar" || dir === "rtl"
    : false;

  const [pageState, setPageState] = useState<PageState>("waiting");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setPageState("invalid");
      return;
    }

    let unsubscribed = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (unsubscribed) return;
      if (event === "PASSWORD_RECOVERY") {
        // Implicit flow: Supabase fires this when the hash contains type=recovery.
        setPageState("form");
      } else if (
        (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
        session &&
        _isRecoveryPageLoad
      ) {
        // PKCE flow fix: Supabase auth-js v2 fires SIGNED_IN (not PASSWORD_RECOVERY)
        // for PKCE recovery codes because _getSessionFromURL returns redirectType=null.
        // INITIAL_SESSION covers the race where the exchange completes before this
        // subscriber is registered. Since _isRecoveryPageLoad is only true when the
        // page was opened with a recovery code/token in the URL, a valid session here
        // is always a recovery session — safe to show the form.
        setPageState("form");
      } else if (event === "SIGNED_OUT") {
        setPageState(prev => prev === "waiting" ? "invalid" : prev);
      }
    });

    // Belt-and-suspenders: if Supabase already exchanged the code and established
    // the session before this useEffect ran (detectSessionInUrl raced ahead),
    // getSession() returns the established session immediately. Covers both PKCE
    // (?code=) and implicit (#type=recovery) recovery links.
    if (_isRecoveryPageLoad) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session && !unsubscribed) setPageState("form");
      });
    }

    // If no PASSWORD_RECOVERY event arrives within 10 s, treat the link as
    // invalid/expired so the user isn't stuck on a spinner forever.
    const timeout = setTimeout(() => {
      if (!unsubscribed) {
        setPageState(prev => prev === "waiting" ? "invalid" : prev);
      }
    }, 10_000);

    return () => {
      unsubscribed = true;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError(isAr ? "خدمة المصادقة غير متاحة." : "Authentication is not configured.");
      return;
    }

    if (newPw.length < 8) {
      setError(isAr ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل." : "Password must be at least 8 characters.");
      return;
    }

    if (newPw !== confirmPw) {
      setError(isAr ? "كلمة المرور غير متطابقة." : "Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) {
        setError(updateErr.message);
        return;
      }
      setPageState("success");
      // Sign out cleanly so the user starts a fresh session after login.
      await supabase.auth.signOut().catch(() => {});
    } catch {
      setError(isAr ? "خطأ في الشبكة. تحقّق من اتصالك." : "Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      dir={dir}
      className="relative w-full min-h-[100dvh] bg-background flex flex-col items-center justify-center px-6 overflow-hidden"
    >
      {/* Background glow — matches the login page aesthetic */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <AnimatePresence mode="wait">

        {/* ── Waiting for Supabase to exchange the recovery token ─────────── */}
        {pageState === "waiting" && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex flex-col items-center gap-4 text-center"
          >
            <Loader2 size={32} className="text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              {isAr ? "جارٍ التحقق من الرابط…" : "Verifying link…"}
            </p>
          </motion.div>
        )}

        {/* ── Invalid / expired link ───────────────────────────────────────── */}
        {pageState === "invalid" && (
          <motion.div
            key="invalid"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-white">
              {isAr ? "الرابط غير صالح أو منتهي" : "Link invalid or expired"}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px]">
              {isAr
                ? "هذا الرابط غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً من صفحة تسجيل الدخول."
                : "This link is invalid or has expired. Request a new one from the sign-in page."}
            </p>
            <button
              onClick={() => setLocation("/login", { replace: true })}
              className="mt-2 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/30"
            >
              {isAr ? "العودة لتسجيل الدخول" : "Back to sign in"}
            </button>
          </motion.div>
        )}

        {/* ── New password form ────────────────────────────────────────────── */}
        {pageState === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="relative z-10 w-full max-w-sm flex flex-col gap-6"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-1">
                <Lock size={24} className="text-primary" />
              </div>
              <h1 className="text-2xl font-display font-bold text-white">
                {isAr ? "كلمة مرور جديدة" : "New password"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isAr ? "اختر كلمة مرور جديدة لحسابك." : "Choose a new password for your account."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* New password */}
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  {isAr ? "كلمة المرور الجديدة" : "New password"}
                </label>
                <div className="relative">
                  <Lock size={15} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none ${isRtl ? "left-10" : "right-10"}`} />
                  <button
                    type="button"
                    onClick={() => setShowNew(v => !v)}
                    className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white/70 transition ${isRtl ? "left-3.5" : "right-3.5"}`}
                    tabIndex={-1}
                  >
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPw}
                    onChange={e => { setNewPw(e.target.value); setError(null); }}
                    autoComplete="new-password"
                    autoFocus
                    required
                    dir="ltr"
                    className={`w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition ${isRtl ? "pl-20" : "pr-20"}`}
                  />
                </div>
              </div>

              {/* Confirm password */}
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  {isAr ? "تأكيد كلمة المرور" : "Confirm password"}
                </label>
                <div className="relative">
                  <Lock size={15} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none ${isRtl ? "left-10" : "right-10"}`} />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white/70 transition ${isRtl ? "left-3.5" : "right-3.5"}`}
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
                    className={`w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition ${isRtl ? "pl-20" : "pr-20"}`}
                  />
                </div>
              </div>

              {/* Error */}
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
                disabled={loading || !newPw || !confirmPw}
                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2 mt-1"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {isAr ? "جارٍ الحفظ…" : "Saving…"}
                  </>
                ) : (
                  isAr ? "حفظ كلمة المرور" : "Save password"
                )}
              </button>
            </form>
          </motion.div>
        )}

        {/* ── Success ──────────────────────────────────────────────────────── */}
        {pageState === "success" && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-white">
              {isAr ? "تم تحديث كلمة المرور" : "Password updated"}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isAr
                ? "يمكنك الآن تسجيل الدخول باستخدام كلمة المرور الجديدة."
                : "You can now sign in with your new password."}
            </p>
            <button
              onClick={() => setLocation("/login", { replace: true })}
              className="mt-2 px-8 py-3.5 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/30"
            >
              {isAr ? "تسجيل الدخول" : "Sign in"}
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
