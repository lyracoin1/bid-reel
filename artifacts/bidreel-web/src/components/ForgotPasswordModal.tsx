/**
 * ForgotPasswordModal.tsx
 *
 * Three-step "Forgot password" flow rendered as a modal over the login screen.
 *
 *   Step 1 — Request:  phone   → POST /api/auth/password-reset/request
 *   Step 2 — Verify:   code    → POST /api/auth/password-reset/verify
 *   Step 3 — Reset:    pw      → POST /api/auth/password-reset/reset
 *
 * All copy is bilingual (en/ar) following the existing login-page convention
 * of branching on `lang === "ar"` inside the same component (the project's
 * `lib/i18n.ts` only covers a fixed key catalog and does not yet include
 * password-reset keys — adding them piecemeal would scatter the flow).
 *
 * The modal NEVER touches the parent login state and it does NOT log the user
 * in on success — by design the user re-enters their new password on the
 * normal sign-in form afterwards. This keeps the existing auth flow untouched.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, Phone, KeyRound, Lock, CheckCircle2 } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { API_BASE } from "@/lib/api-client";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

// Length of the verification code expected by /api/auth/password-reset/verify.
// The server accepts 4–8 digits but always issues 6, so we lock the UI to 6.
const OTP_LENGTH = 6;

type Step = "request" | "verify" | "reset" | "done";

const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional starting phone — passed through from a "phone" field if present. */
  initialPhone?: string;
}

interface ApiError {
  error?: string;
  message?: string;
  retryAfterSeconds?: number;
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & ApiError }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  let data: T & ApiError;
  try {
    data = (await res.json()) as T & ApiError;
  } catch {
    data = {} as T & ApiError;
  }
  return { ok: res.ok, status: res.status, data };
}

export default function ForgotPasswordModal({ open, onClose, initialPhone }: Props) {
  const { lang, dir } = useLang();
  const isRtl = dir === "rtl";
  const isAr = lang === "ar";

  const [step, setStep] = useState<Step>("request");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Cooldown timer — seconds remaining before "Resend code" becomes clickable.
  // Started after every successful request/resend so users can't spam the
  // server (and burn Wapilot credits). Decrements 1/sec via setInterval.
  const [resendIn, setResendIn] = useState(0);

  const phoneRef = useRef<HTMLInputElement>(null);
  // input-otp's <OTPInput> renders an <input> internally and accepts a ref.
  const codeRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  // Reset everything whenever the modal is opened fresh.
  useEffect(() => {
    if (open) {
      setStep("request");
      setPhone(initialPhone ?? "");
      setCode("");
      setNewPassword("");
      setResetToken("");
      setError(null);
      setInfo(null);
      setLoading(false);
      setResendIn(0);
      setTimeout(() => phoneRef.current?.focus(), 50);
    }
  }, [open, initialPhone]);

  // Countdown ticker — runs only when there's time remaining and the modal
  // is open. Safe to rely on setInterval here because the modal lives at
  // most a few minutes; no drift correction needed.
  useEffect(() => {
    if (!open || resendIn <= 0) return;
    const id = setInterval(() => {
      setResendIn(s => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [open, resendIn]);

  // Autofocus the relevant input on each step change.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (step === "request") phoneRef.current?.focus();
      else if (step === "verify") codeRef.current?.focus();
      else if (step === "reset") pwRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [step, open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  // ── Copy ──────────────────────────────────────────────────────────────────
  const copy = {
    title: isAr ? "إعادة تعيين كلمة المرور" : "Reset password",
    subtitleRequest: isAr
      ? "أدخل رقم هاتفك وسنرسل إليك رمز التحقق عبر واتساب."
      : "Enter your phone number and we'll send you a verification code on WhatsApp.",
    subtitleVerify: isAr
      ? "أدخل الرمز المكوّن من 6 أرقام الذي أرسلناه إلى واتساب."
      : "Enter the 6-digit code we sent to your WhatsApp.",
    subtitleReset: isAr
      ? "اختر كلمة مرور جديدة لحسابك."
      : "Choose a new password for your account.",
    phoneLbl: isAr ? "رقم الهاتف" : "Phone number",
    phonePh: isAr ? "+20XXXXXXXXXX" : "+20XXXXXXXXXX",
    codeLbl: isAr ? "رمز التحقق" : "Verification code",
    codePh: isAr ? "123456" : "123456",
    pwLbl: isAr ? "كلمة المرور الجديدة" : "New password",
    pwPh: isAr ? "8 أحرف على الأقل" : "At least 8 characters",
    sendBtn: isAr ? "إرسال الرمز" : "Send code",
    verifyBtn: isAr ? "تحقّق" : "Verify",
    resetBtn: isAr ? "إعادة تعيين كلمة المرور" : "Reset password",
    submitting: isAr ? "جارٍ التحقق…" : "Please wait…",
    sending: isAr ? "جارٍ الإرسال…" : "Sending…",
    resending: isAr ? "إعادة الإرسال…" : "Resending…",
    resend: isAr ? "إعادة إرسال الرمز" : "Resend code",
    resendIn: (s: number) => isAr ? `إعادة الإرسال متاحة بعد ${s} ث` : `Resend available in ${s}s`,
    networkErr: isAr ? "خطأ في الشبكة. تحقّق من اتصالك." : "Network error. Check your connection.",
    invalidPhone: isAr ? "رقم هاتف غير صالح. استخدم الصيغة الدولية (+20…)." : "Invalid phone. Use international format (e.g. +20…).",
    invalidCode: isAr ? "الرمز يجب أن يكون 6 أرقام." : "Code must be 6 digits.",
    pwTooShort: isAr ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل." : "Password must be at least 8 characters.",
    requestOk: isAr
      ? "إذا كان الرقم مسجلاً لدينا، فقد أرسلنا الرمز إلى واتساب."
      : "If this phone is registered, we've sent the code to WhatsApp.",
    invalidOrExpired: isAr ? "الرمز غير صالح أو منتهي." : "Invalid or expired code.",
    tooManyAttempts: isAr ? "محاولات كثيرة. اطلب رمزاً جديداً." : "Too many attempts. Request a new code.",
    resendLimit: isAr
      ? "لقد وصلت إلى الحد الأقصى لإعادة الإرسال. يرجى المحاولة لاحقاً."
      : "You have reached the maximum resend limit. Please try again later.",
    invalidToken: isAr ? "انتهت صلاحية الجلسة. ابدأ من جديد." : "Session expired. Please start over.",
    doneTitle: isAr ? "تم تحديث كلمة المرور" : "Password updated",
    doneBody: isAr
      ? "يمكنك الآن تسجيل الدخول باستخدام كلمة المرور الجديدة."
      : "You can now sign in with your new password.",
    doneClose: isAr ? "العودة لتسجيل الدخول" : "Back to sign in",
    closeAria: isAr ? "إغلاق" : "Close",
    stepLabel: (n: number) => isAr ? `الخطوة ${n} من 3` : `Step ${n} of 3`,
  };

  // Map server error codes to localized strings. INVALID_CODE is a forward-
  // compatible alias for INVALID_OR_EXPIRED — both surface the same UX
  // message ("Invalid or expired code.") so future server tweaks that
  // return a more specific code don't require another frontend edit.
  function mapErr(code: string | undefined, fallback?: string | null): string {
    switch (code) {
      case "INVALID_INPUT": return fallback ?? copy.invalidPhone;
      case "INVALID_CODE":
      case "INVALID_OR_EXPIRED": return copy.invalidOrExpired;
      case "TOO_MANY_ATTEMPTS": return copy.tooManyAttempts;
      case "RESEND_LIMIT": return copy.resendLimit;
      case "INVALID_TOKEN": return copy.invalidToken;
      default: return fallback ?? copy.networkErr;
    }
  }

  // ── Step 1: request OTP ───────────────────────────────────────────────────
  async function handleRequest(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    const trimmed = phone.trim();
    if (!/^\+?[1-9]\d{6,14}$/.test(trimmed)) {
      setError(copy.invalidPhone);
      return;
    }
    setLoading(true);
    try {
      const { ok, data } = await postJson<{ ok: boolean }>("/auth/password-reset/request", { phone: trimmed });
      if (!ok && data.error !== "RESEND_LIMIT") {
        setError(mapErr(data.error, data.message));
        return;
      }
      // Always advance — generic 200 hides whether the phone is registered.
      setInfo(copy.requestOk);
      setStep("verify");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: verify OTP ───────────────────────────────────────────────────
  async function handleVerify(e?: React.FormEvent, codeOverride?: string) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    // Accept an explicit override so the auto-submit path (called from the
    // OTP onChange handler in the same render tick) doesn't read a stale
    // `code` from React state.
    const trimmedCode = (codeOverride ?? code).trim();
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(trimmedCode)) {
      setError(copy.invalidCode);
      return;
    }
    setLoading(true);
    try {
      const { ok, data } = await postJson<{ ok: boolean; resetToken?: string }>(
        "/auth/password-reset/verify",
        { phone: phone.trim(), code: trimmedCode },
      );
      if (!ok || !data.resetToken) {
        setError(mapErr(data.error, data.message));
        return;
      }
      setResetToken(data.resetToken);
      setStep("reset");
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: reset password ───────────────────────────────────────────────
  async function handleReset(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (newPassword.length < 8) {
      setError(copy.pwTooShort);
      return;
    }
    setLoading(true);
    try {
      const { ok, data } = await postJson<{ ok: boolean }>(
        "/auth/password-reset/reset",
        { resetToken, newPassword },
      );
      if (!ok) {
        setError(mapErr(data.error, data.message));
        // If the token was invalidated, send the user back to the start.
        if (data.error === "INVALID_TOKEN") setStep("request");
        return;
      }
      setStep("done");
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  // ── Resend code on the verify step ───────────────────────────────────────
  // Disabled while loading OR while the cooldown is active. The cooldown is
  // restarted on every successful resend to keep the spam guarantee.
  async function handleResend() {
    if (loading || resendIn > 0) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { ok, data } = await postJson<{ ok: boolean }>("/auth/password-reset/request", { phone: phone.trim() });
      if (!ok) {
        setError(mapErr(data.error, data.message));
        // RESEND_LIMIT comes back when the server's per-row resend cap is hit.
        // Keep the user on the verify step but extend the cooldown so they
        // can't keep retrying.
        if (data.error === "RESEND_LIMIT") setResendIn(RESEND_COOLDOWN_SECONDS);
        return;
      }
      setInfo(copy.requestOk);
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const stepIndex = step === "request" ? 1 : step === "verify" ? 2 : 3;

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
            aria-label={copy.closeAria}
            className={`absolute top-3 ${isRtl ? "left-3" : "right-3"} text-muted-foreground hover:text-white transition p-1`}
            disabled={loading}
          >
            <X size={18} />
          </button>

          {/* Header */}
          <div className="flex flex-col items-center gap-2 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              {step === "done"
                ? <CheckCircle2 size={22} className="text-primary" />
                : step === "request" ? <Phone size={20} className="text-primary" />
                : step === "verify" ? <KeyRound size={20} className="text-primary" />
                : <Lock size={20} className="text-primary" />}
            </div>
            <h2 id="forgot-pw-title" className="text-lg font-display font-bold text-white text-center">
              {step === "done" ? copy.doneTitle : copy.title}
            </h2>
            {step !== "done" && (
              <>
                <p className={`text-xs text-muted-foreground/80 font-medium tracking-wide ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.stepLabel(stepIndex)}
                </p>
                <p className="text-sm text-muted-foreground text-center leading-relaxed">
                  {step === "request" ? copy.subtitleRequest
                    : step === "verify" ? copy.subtitleVerify
                    : copy.subtitleReset}
                </p>
              </>
            )}
          </div>

          {/* Step 1 */}
          {step === "request" && (
            <form onSubmit={handleRequest} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.phoneLbl}
                </label>
                <input
                  ref={phoneRef}
                  type="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setError(null); }}
                  placeholder={copy.phonePh}
                  autoComplete="tel"
                  required
                  dir="ltr"
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
                />
              </div>
              <ErrInfo error={error} info={info} isRtl={isRtl} />
              <SubmitBtn loading={loading} label={copy.sendBtn} loadingLabel={copy.sending} />
            </form>
          )}

          {/* Step 2 — 6-digit OTP via input-otp.
              - Numeric only, autoFocus on first slot, paste-aware (the
                `input-otp` lib distributes pasted digits across slots).
              - Auto-submits as soon as the user fills the final slot, so
                the most common path (type 6 digits) requires no extra
                click on the Verify button. */}
          {step === "verify" && (
            <form onSubmit={handleVerify} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 items-center">
                <label className={`text-sm text-muted-foreground font-medium self-stretch ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.codeLbl}
                </label>
                <InputOTP
                  ref={codeRef}
                  maxLength={OTP_LENGTH}
                  value={code}
                  onChange={(v: string) => {
                    // Defensive — `input-otp` already restricts to digits
                    // when `pattern` is set, but we strip again to be safe.
                    const digitsOnly = v.replace(/\D/g, "").slice(0, OTP_LENGTH);
                    setCode(digitsOnly);
                    setError(null);
                    if (digitsOnly.length === OTP_LENGTH && !loading) {
                      // Auto-submit the moment the code is complete. Pass the
                      // value explicitly — `code` state hasn't flushed yet in
                      // this render tick, so reading it inside handleVerify
                      // would still see the previous (5-digit) value.
                      void handleVerify(undefined, digitsOnly);
                    }
                  }}
                  pattern="^[0-9]+$"
                  inputMode="numeric"
                  autoFocus
                  containerClassName="justify-center"
                  dir="ltr"
                >
                  <InputOTPGroup>
                    {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 w-11 text-xl font-mono bg-muted/40 border-border text-white"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <ErrInfo error={error} info={info} isRtl={isRtl} />
              <SubmitBtn loading={loading} label={copy.verifyBtn} loadingLabel={copy.submitting} />
              <button
                type="button"
                onClick={handleResend}
                disabled={loading || resendIn > 0}
                className="text-xs text-primary/90 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition self-center mt-1"
              >
                {loading
                  ? copy.resending
                  : resendIn > 0
                    ? copy.resendIn(resendIn)
                    : copy.resend}
              </button>
            </form>
          )}

          {/* Step 3 */}
          {step === "reset" && (
            <form onSubmit={handleReset} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.pwLbl}
                </label>
                <input
                  ref={pwRef}
                  type="password"
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setError(null); }}
                  placeholder={copy.pwPh}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  dir="ltr"
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
                />
              </div>
              <ErrInfo error={error} info={info} isRtl={isRtl} />
              <SubmitBtn loading={loading} label={copy.resetBtn} loadingLabel={copy.submitting} />
            </form>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-muted-foreground text-center leading-relaxed">{copy.doneBody}</p>
              <button
                type="button"
                onClick={onClose}
                className="w-full bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl py-3 transition-colors"
              >
                {copy.doneClose}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────
function SubmitBtn({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2"
    >
      {loading ? <><Loader2 size={16} className="animate-spin" />{loadingLabel}</> : label}
    </button>
  );
}

function ErrInfo({ error, info, isRtl }: { error: string | null; info: string | null; isRtl: boolean }) {
  return (
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
      {info && !error && (
        <motion.p
          key="info"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={`text-sm text-primary/90 ${isRtl ? "text-right" : "text-left"}`}
        >
          {info}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
