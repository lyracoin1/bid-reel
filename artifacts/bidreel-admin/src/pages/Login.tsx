import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, Lock, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password,
      });

      if (authError) {
        if (authError.message.includes("Invalid login credentials")) {
          setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
        } else if (authError.message.includes("Email not confirmed")) {
          setError("يرجى تأكيد بريدك الإلكتروني أولاً قبل تسجيل الدخول");
        } else {
          setError(authError.message);
        }
        return;
      }

      if (!data.session) {
        setError("فشل تسجيل الدخول، يرجى المحاولة مرة أخرى");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", data.session.user.id)
        .maybeSingle();

      if (!profile?.is_admin) {
        await supabase.auth.signOut();
        setError("هذا الحساب لا يملك صلاحيات الإدارة");
        return;
      }

      setLocation("/");
    } catch {
      setError("خطأ في الشبكة، يرجى التحقق من اتصالك");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#030305] flex items-center justify-center p-4 overflow-hidden">

      {/* Ambient glow — matches main app */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-sm">

        {/* Logo + heading */}
        <div className="flex flex-col items-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}logo-icon.png`}
            alt="BidReel"
            className="w-20 h-20 rounded-2xl mb-5 box-glow"
          />
          <h1 className="text-2xl font-display font-bold text-white text-center">BidReel Admin</h1>
          <p className="text-sm text-muted-foreground text-center mt-1.5">تسجيل دخول لوحة الإدارة</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground font-medium text-right">
              البريد الإلكتروني
            </label>
            <div className="relative">
              <Mail size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null); }}
                autoComplete="email"
                autoFocus
                dir="ltr"
                required
                className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 pr-11 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition text-right"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setLocation("/forgot-password")}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                نسيت كلمة المرور؟
              </button>
              <label className="text-sm text-muted-foreground font-medium">
                كلمة المرور
              </label>
            </div>
            <div className="relative">
              <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                autoComplete="current-password"
                dir="ltr"
                required
                className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 pr-11 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm" dir="rtl">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2 mt-1"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                جارٍ تسجيل الدخول…
              </>
            ) : (
              "دخول"
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground/40 mt-8">
          BidReel Admin Panel · admin.bid-reel.com
        </p>
      </div>
    </div>
  );
}
