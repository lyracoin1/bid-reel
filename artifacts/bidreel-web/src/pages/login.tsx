import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { setToken, API_BASE } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────

type Mode = "signin" | "signup";

// ── Component ──────────────────────────────────────────────────────────────────

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { lang, dir } = useLang();
  const isRtl = dir === "rtl";

  // Support ?tab=signup so the admin preview panel and deep-links can open
  // the sign-up form directly. Default to sign-in for returning users.
  const initialMode: Mode = new URLSearchParams(search).get("tab") === "signup" ? "signup" : "signin";
  const [mode, setMode]         = useState<Mode>(initialMode);
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  const copy = {
    title:     lang === "ar" ? "مرحباً بك في BidReel" : "Welcome to BidReel",
    emailLbl:  lang === "ar" ? "البريد الإلكتروني" : "Email",
    passwordLbl: lang === "ar" ? "كلمة المرور" : "Password",
    confirmLbl: lang === "ar" ? "تأكيد كلمة المرور" : "Confirm password",
    signinBtn: lang === "ar" ? "دخول" : "Sign in",
    signupBtn: lang === "ar" ? "إنشاء حساب" : "Create account",
    switchToSignup: lang === "ar" ? "مستخدم جديد؟ إنشاء حساب" : "New here? Create account",
    switchToSignin: lang === "ar" ? "لديك حساب؟ تسجيل الدخول" : "Already have an account? Sign in",
    submitting: lang === "ar" ? "جارٍ التحقق…" : "Please wait…",
    networkErr: lang === "ar" ? "خطأ في الشبكة، تحقق من اتصالك" : "Network error. Check your connection.",
    pwMismatch: lang === "ar" ? "كلمة المرور غير متطابقة" : "Passwords do not match.",
    pwShort:    lang === "ar" ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters.",
    verifyTitle: lang === "ar" ? "تحقق من بريدك الإلكتروني" : "Verify your email",
    verifyBody:  lang === "ar"
      ? "أرسلنا رابط التحقق إلى بريدك الإلكتروني. افتح الرابط ثم عد للتسجيل."
      : "We sent a verification link to your email. Open the link, then come back to sign in.",
    backToLogin: lang === "ar" ? "العودة لتسجيل الدخول" : "Back to sign in",
  };

  function clearForm() {
    setError(null);
    setPassword("");
    setConfirm("");
  }

  function switchMode(next: Mode) {
    setMode(next);
    clearForm();
  }

  // ── After successful sign-in: ensure profile exists, then route ──────────────
  async function afterSignIn(accessToken: string) {
    setToken(accessToken);

    try {
      const res = await fetch(`${API_BASE}/auth/ensure-profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json() as { isNewUser: boolean; user: { isCompleted: boolean } };
        const seen = localStorage.getItem("hasSeenInterests");
        const isComplete = data.user?.isCompleted ?? false;
        setLocation((!isComplete || !seen) ? "/interests" : "/feed");
      } else {
        // Profile creation failed — still redirect to interests for setup
        setLocation("/interests");
      }
    } catch {
      // Network error on ensure-profile — still let user in
      setLocation("/interests");
    }
  }

  // ── Sign in ──────────────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) return;

    if (!supabase) {
      setError("Authentication is not configured. Contact support.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        if (authError.message.includes("Invalid login credentials")) {
          setError(lang === "ar"
            ? "البريد الإلكتروني أو كلمة المرور غير صحيحة"
            : "Incorrect email or password.");
        } else if (authError.message.includes("Email not confirmed")) {
          setError(lang === "ar"
            ? "يرجى تأكيد بريدك الإلكتروني أولاً — تحقق من صندوق الوارد"
            : "Please verify your email first — check your inbox.");
        } else {
          setError(authError.message);
        }
        return;
      }

      if (!data.session) {
        setError(lang === "ar" ? "فشل تسجيل الدخول، حاول مرة أخرى" : "Sign in failed. Try again.");
        return;
      }

      await afterSignIn(data.session.access_token);
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  // ── Sign up ──────────────────────────────────────────────────────────────────
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password || !confirm) return;

    if (!supabase) {
      setError("Authentication is not configured. Contact support.");
      return;
    }

    if (password.length < 8) {
      setError(copy.pwShort);
      return;
    }

    if (password !== confirm) {
      setError(copy.pwMismatch);
      return;
    }

    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;

      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { emailRedirectTo: redirectTo },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // If email confirmation is disabled in Supabase, session is returned immediately.
      if (data.session) {
        await afterSignIn(data.session.access_token);
        return;
      }

      // Standard flow: email confirmation required — show check-email screen.
      setSignedUp(true);
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  // ── Render: check-email success screen ──────────────────────────────────────
  if (signedUp) {
    return (
      <div
        dir={dir}
        className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden px-6"
      >
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5 text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-display font-bold text-white">{copy.verifyTitle}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{copy.verifyBody}</p>
          <button
            onClick={() => { setSignedUp(false); switchMode("signin"); }}
            className="mt-2 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            {copy.backToLogin}
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Render: main login/signup form ──────────────────────────────────────────
  return (
    <div
      dir={dir}
      className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden px-6"
    >
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
        </motion.div>

        {/* Tab toggle */}
        <div className="flex rounded-xl bg-muted/30 border border-border p-1 gap-1">
          {(["signup", "signin"] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-white"
              }`}
            >
              {m === "signin"
                ? (lang === "ar" ? "تسجيل الدخول" : "Sign in")
                : (lang === "ar" ? "حساب جديد" : "Sign up")}
            </button>
          ))}
        </div>

        {/* Form */}
        <AnimatePresence mode="wait">
          <motion.form
            key={mode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            onSubmit={mode === "signin" ? handleSignIn : handleSignUp}
            className="flex flex-col gap-4"
          >
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                {copy.emailLbl}
              </label>
              <div className="relative">
                <Mail size={16} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none ${isRtl ? "left-3.5" : "right-3.5"}`} />
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null); }}
                  autoComplete="email"
                  autoFocus
                  required
                  dir="ltr"
                  className={`w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition ${isRtl ? "pl-11" : "pr-11"}`}
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                {copy.passwordLbl}
              </label>
              <div className="relative">
                <Lock size={16} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none ${isRtl ? "left-10" : "right-10"}`} />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white/70 transition ${isRtl ? "left-3.5" : "right-3.5"}`}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  dir="ltr"
                  className={`w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition ${isRtl ? "pl-20" : "pr-20"}`}
                />
              </div>
            </div>

            {/* Confirm password — signup only */}
            {mode === "signup" && (
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm text-muted-foreground font-medium ${isRtl ? "text-right" : "text-left"}`}>
                  {copy.confirmLbl}
                </label>
                <div className="relative">
                  <Lock size={16} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none ${isRtl ? "left-3.5" : "right-3.5"}`} />
                  <input
                    type={showPw ? "text" : "password"}
                    value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError(null); }}
                    autoComplete="new-password"
                    required
                    dir="ltr"
                    className={`w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition ${isRtl ? "pl-11" : "pr-11"}`}
                  />
                </div>
              </div>
            )}

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

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email.trim() || !password || (mode === "signup" && !confirm)}
              className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2 mt-1"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" />{copy.submitting}</>
                : mode === "signin" ? copy.signinBtn : copy.signupBtn
              }
            </button>
          </motion.form>
        </AnimatePresence>
      </div>
    </div>
  );
}
