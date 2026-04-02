import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, X, Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { setToken } from "@/lib/api-client";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API_BASE = `${BASE}/api`;

interface LoginResponse {
  token: string;
  isNewUser: boolean;
  user: { id: string; isAdmin: boolean };
}
interface ApiError {
  error: string;
  message: string;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { lang, dir } = useLang();

  // ── Normal login state ───────────────────────────────────────────────────
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Admin login panel state ──────────────────────────────────────────────
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminPhone, setAdminPhone] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);

  const isRtl = dir === "rtl";

  const copy = {
    title:      lang === "ar" ? "مرحباً بك في BidReel" : "Welcome to BidReel",
    subtitle:   lang === "ar" ? "أدخل رقم هاتفك لتسجيل الدخول" : "Enter your phone number to sign in",
    phoneLbl:   lang === "ar" ? "رقم الهاتف" : "Phone number",
    phonePh:    lang === "ar" ? "مثال: 01060088141" : "e.g. 01060088141 or +14155550001",
    phoneHint:  lang === "ar"
      ? "أدخل الرقم المحلي أو الدولي — لا حاجة لكود البلد إذا كنت في مصر"
      : "Local or international format. Egyptian numbers (01…) are accepted as-is.",
    submit:     lang === "ar" ? "دخول" : "Sign in",
    submitting: lang === "ar" ? "جارٍ الدخول…" : "Signing in…",
    tooShort:   lang === "ar" ? "رقم الهاتف قصير جداً" : "Phone number is too short",
    networkErr: lang === "ar" ? "خطأ في الشبكة، تحقق من اتصالك" : "Network error. Check your connection.",
  };

  function cleanedPhone() {
    return phone.replace(/[\s\-\(\)\.]/g, "").trim();
  }

  function cleanedAdminPhone() {
    return adminPhone.replace(/[\s\-\(\)\.]/g, "").trim();
  }

  // ── Shared post-login handler ────────────────────────────────────────────
  function handleLoginSuccess(data: LoginResponse) {
    setToken(data.token);
    console.log(
      `[auth] ✅ login OK — userId=${data.user?.id} isNew=${data.isNewUser} isAdmin=${data.user?.isAdmin}`
    );

    if (data.user?.isAdmin) {
      // Auto-set the admin panel session so AdminGuard skips the password prompt.
      // The user already proved identity with the secret admin code during login.
      sessionStorage.setItem("bidreel_admin_ts", String(Date.now()));
      setLocation("/admin");
      return;
    }

    const seen = localStorage.getItem("hasSeenInterests");
    setLocation(seen ? "/feed" : "/interests");
  }

  // ── Normal login submit ──────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleaned = cleanedPhone();
    if (cleaned.length < 7) {
      setError(copy.tooShort);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: cleaned }),
      });
      const data = await res.json() as LoginResponse & ApiError;

      if (!res.ok) {
        setError(data.message ?? (lang === "ar" ? "فشل تسجيل الدخول" : "Sign in failed. Please try again."));
        return;
      }

      handleLoginSuccess(data);
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  // ── Admin login submit ───────────────────────────────────────────────────
  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);

    const cleaned = cleanedAdminPhone();
    if (cleaned.length < 7) {
      setAdminError(lang === "ar" ? "رقم الهاتف قصير جداً" : "Phone number is too short");
      return;
    }
    if (!adminCode.trim()) {
      setAdminError("يرجى إدخال كود الأدمن");
      return;
    }

    setAdminLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: cleaned, adminCode: adminCode.trim() }),
      });
      const data = await res.json() as LoginResponse & ApiError;

      if (!res.ok) {
        setAdminError(data.message ?? "فشل تسجيل دخول الأدمن");
        return;
      }

      handleLoginSuccess(data);
    } catch {
      setAdminError(lang === "ar" ? "خطأ في الشبكة، تحقق من اتصالك" : "Network error.");
    } finally {
      setAdminLoading(false);
    }
  }

  return (
    <div
      dir={dir}
      className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden px-6"
    >
      {/* Background glow */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-sm flex flex-col gap-6">
        {/* Logo + heading */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col items-center"
        >
          <img
            src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
            alt="BidReel"
            className="w-20 h-20 rounded-2xl mb-5 box-glow"
          />
          <h1 className="text-2xl font-display font-bold text-white text-center">{copy.title}</h1>
          <p className="text-sm text-muted-foreground text-center mt-1.5">{copy.subtitle}</p>
        </motion.div>

        {/* ── Normal phone login form ── */}
        <AnimatePresence mode="wait">
          {!showAdmin ? (
            <motion.form
              key="normal-login"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.phoneLbl}
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setError(null); }}
                  placeholder={copy.phonePh}
                  autoFocus
                  autoComplete="tel"
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
                  dir="ltr"
                />
                <p className={`text-xs text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.phoneHint}
                </p>
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
                disabled={loading || cleanedPhone().length < 7}
                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors"
              >
                {loading ? copy.submitting : copy.submit}
              </button>

              {/* Admin login entry point */}
              <button
                type="button"
                onClick={() => { setShowAdmin(true); setError(null); }}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-white/8 bg-white/3 text-sm font-semibold text-white/40 hover:text-white/65 hover:bg-white/5 hover:border-white/15 transition-all"
              >
                <ShieldCheck size={15} className="opacity-70" />
                دخول الأدمن
              </button>
            </motion.form>

          ) : (
            /* ── Admin login panel ── */
            <motion.form
              key="admin-login"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              onSubmit={handleAdminSubmit}
              className="flex flex-col gap-4"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                    <ShieldCheck size={14} className="text-amber-400" />
                  </div>
                  <span className="text-sm font-bold text-white">دخول الأدمن</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAdmin(false); setAdminError(null); setAdminCode(""); setAdminPhone(""); }}
                  className="w-7 h-7 rounded-full bg-white/8 flex items-center justify-center text-white/50 hover:text-white/80 transition"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Phone field */}
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  رقم الهاتف
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={adminPhone}
                  onChange={e => { setAdminPhone(e.target.value); setAdminError(null); }}
                  placeholder="مثال: 01060088141"
                  autoFocus
                  autoComplete="tel"
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition"
                  dir="ltr"
                />
              </div>

              {/* Admin code field */}
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  كود الأدمن
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={adminCode}
                  onChange={e => { setAdminCode(e.target.value); setAdminError(null); }}
                  placeholder="أدخل الكود السري"
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition"
                  dir="ltr"
                />
              </div>

              {/* Error */}
              <AnimatePresence>
                {adminError && (
                  <motion.p
                    key="admin-err"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-sm text-destructive text-right"
                  >
                    {adminError}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button
                type="submit"
                disabled={adminLoading || cleanedAdminPhone().length < 7 || !adminCode.trim()}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2"
              >
                {adminLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    جارٍ التحقق…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    تسجيل الدخول كأدمن
                  </>
                )}
              </button>

              {/* Back to normal login */}
              <button
                type="button"
                onClick={() => { setShowAdmin(false); setAdminError(null); setAdminCode(""); setAdminPhone(""); }}
                className="text-sm text-muted-foreground text-center hover:text-white/60 transition"
              >
                العودة إلى الدخول العادي
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
