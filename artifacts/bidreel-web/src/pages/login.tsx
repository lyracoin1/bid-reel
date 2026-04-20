import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { setToken, API_BASE } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { isNative, OAUTH_REDIRECT_URL, openInBrowser } from "@/lib/capacitor-app";
import ForgotPasswordModal from "@/components/ForgotPasswordModal";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

// ── Feature flags ──────────────────────────────────────────────────────────────
// Set to true to re-enable Google OAuth once the flow is verified in production.
const GOOGLE_AUTH_ENABLED = true;

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
  const [forgotOpen, setForgotOpen] = useState(false);

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
    orContinueWith: lang === "ar" ? "أو تابع بـ" : "or continue with",
    googleSignIn: lang === "ar" ? "تسجيل الدخول بـ Google" : "Continue with Google",
    forgotPw: lang === "ar" ? "هل نسيت كلمة السر؟" : "Forgot password?",
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
        const isNewUser = data.isNewUser ?? false;
        const isComplete = data.user?.isCompleted ?? false;
        // Only route genuinely new users to /interests for onboarding.
        // Existing users (isNewUser === false) go straight to /feed even if some
        // profile fields are missing — incomplete-profile enforcement happens at
        // the action level (e.g. create-auction), not at login time.
        // REPLACE — login screen must NEVER live in the back stack.
        setLocation(isNewUser && !isComplete ? "/interests" : "/feed", { replace: true });
      } else {
        // Profile creation failed — let the user into the app anyway.
        setLocation("/feed", { replace: true });
      }
    } catch {
      // Network error on ensure-profile — let user in, don't block at login.
      setLocation("/feed", { replace: true });
    }
  }

  // ── Google Sign-In ────────────────────────────────────────────────────────────
  const [googleLoading, setGoogleLoading] = useState(false);

  // On Capacitor (Android/iOS): when the user returns from the Google OAuth
  // Custom Tab — whether they completed auth or pressed Back to cancel — the
  // app receives a "resume" DOM event.  If auth succeeded, CapacitorOAuthHandler
  // in App.tsx will have already navigated away (unmounting this component) so
  // the setGoogleLoading call is a harmless no-op.  If the user cancelled, this
  // resets the stuck spinner so they can try again.
  useEffect(() => {
    if (!googleLoading || !isNative()) return;

    function onResume() {
      // Give CapacitorOAuthHandler a brief window to fire appUrlOpen first.
      // If navigation happened, this component is already unmounted.
      setTimeout(() => setGoogleLoading(false), 800);
    }

    document.addEventListener("resume", onResume);
    return () => document.removeEventListener("resume", onResume);
  }, [googleLoading]);

  async function handleGoogleSignIn() {
    if (!supabase) {
      setError("Authentication is not configured. Contact support.");
      return;
    }
    setGoogleLoading(true);
    setError(null);
    try {
      if (isNative()) {
        // On Capacitor (native Android/iOS): use skipBrowserRedirect so Supabase
        // returns the OAuth URL without navigating the WebView.  We then open the
        // URL with @capacitor/browser (openInBrowser) which spawns a Chrome Custom
        // Tab (external browser process), keeping the WebView alive on the React app.
        // When Google completes auth it redirects to com.bidreel.app://auth/callback
        // which Android routes back into the app via the intent filter in
        // AndroidManifest.xml, firing the appUrlOpen event that CapacitorOAuthHandler
        // in App.tsx listens for.
        console.log("[GoogleSignIn] Native platform — using skipBrowserRedirect flow");
        const { data, error: authError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: OAUTH_REDIRECT_URL,
            skipBrowserRedirect: true,
          },
        });
        if (authError) {
          console.error("[GoogleSignIn] signInWithOAuth error:", authError.message);
          setError(authError.message);
          setGoogleLoading(false);
          return;
        }
        if (!data.url) {
          console.error("[GoogleSignIn] No OAuth URL returned from Supabase");
          setError("Could not start Google Sign-In. Try again.");
          setGoogleLoading(false);
          return;
        }
        console.log("[GoogleSignIn] Opening OAuth URL in Chrome Custom Tab:", data.url);
        // openInBrowser uses @capacitor/browser which opens a true Chrome Custom
        // Tab (not an in-app WebView).  This guarantees that when Google redirects
        // to com.bidreel.app://auth/callback, Android's intent system routes it
        // to MainActivity and Capacitor fires appUrlOpen on the JS bridge.
        await openInBrowser(data.url);
        // Spinner is reset by the resume event listener above when the user returns.
      } else {
        // On the web: let Supabase redirect the page — OAuthCallbackHandler in
        // App.tsx handles the code/token → session flow on page reload.
        const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (authError) {
          setError(authError.message);
          setGoogleLoading(false);
        }
        // Supabase navigates the page away — no need to set loading=false.
      }
    } catch {
      setError(copy.networkErr);
      setGoogleLoading(false);
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
        if (
          authError.message.includes("Invalid login credentials") ||
          authError.message.includes("invalid_credentials")
        ) {
          // Supabase GoTrue v2 returns this for BOTH wrong credentials AND
          // unconfirmed email (intentional obfuscation to prevent enumeration).
          setError(lang === "ar"
            ? "البريد الإلكتروني أو كلمة المرور غير صحيحة. إذا سجّلت حديثاً، تأكد من تفعيل بريدك الإلكتروني أولاً."
            : "Incorrect email or password. If you signed up recently, confirm your email first.");
        } else if (
          authError.message.includes("Email not confirmed") ||
          authError.message.includes("email_not_confirmed")
        ) {
          setError(lang === "ar"
            ? "يرجى تأكيد بريدك الإلكتروني أولاً — تحقق من صندوق الوارد وانقر رابط التفعيل"
            : "Please verify your email first — check your inbox and click the confirmation link.");
        } else if (
          authError.message === "Failed to fetch" ||
          authError.message.toLowerCase().includes("network") ||
          authError.message.toLowerCase().includes("fetch")
        ) {
          // Supabase SDK wraps network errors as authError.message, not as thrown
          // exceptions, so we must intercept them here and show a friendly message.
          setError(copy.networkErr);
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
        if (
          authError.message === "Failed to fetch" ||
          authError.message.toLowerCase().includes("network") ||
          authError.message.toLowerCase().includes("fetch")
        ) {
          setError(copy.networkErr);
        } else {
          setError(authError.message);
        }
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

        {/* Google Sign-In — hidden while GOOGLE_AUTH_ENABLED is false */}
        {GOOGLE_AUTH_ENABLED && (
          <>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 bg-white/8 hover:bg-white/12 disabled:opacity-50 disabled:cursor-not-allowed border border-white/15 rounded-xl py-3.5 text-white text-sm font-semibold transition-colors"
            >
              {googleLoading ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
              {googleLoading ? copy.submitting : copy.googleSignIn}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30 font-medium">{copy.orContinueWith}</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          </>
        )}

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

            {/* Forgot password — sign-in only */}
            {mode === "signin" && (
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className={`text-sm text-primary/90 hover:text-primary transition-colors -mt-1 ${isRtl ? "self-start" : "self-end"}`}
              >
                {copy.forgotPw}
              </button>
            )}

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

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}
