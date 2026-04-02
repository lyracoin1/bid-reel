import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/contexts/LanguageContext";
import { setToken } from "@/lib/api-client";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API_BASE = `${BASE}/api`;

interface LoginResponse {
  token: string;
  isNewUser: boolean;
}
interface ApiError {
  error: string;
  message: string;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { lang, dir } = useLang();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

      setToken(data.token);
      const seen = localStorage.getItem("hasSeenInterests");
      setLocation(seen ? "/feed" : "/interests");
    } catch {
      setError(copy.networkErr);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      dir={dir}
      className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden px-6"
    >
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col items-center mb-10"
        >
          <img
            src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
            alt="BidReel"
            className="w-20 h-20 rounded-2xl mb-5 box-glow"
          />
          <h1 className="text-2xl font-display font-bold text-white text-center">{copy.title}</h1>
          <p className="text-sm text-muted-foreground text-center mt-1.5">{copy.subtitle}</p>
        </motion.div>

        <motion.form
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
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
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors mt-1"
          >
            {loading ? copy.submitting : copy.submit}
          </button>
        </motion.form>
      </div>
    </div>
  );
}
