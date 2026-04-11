import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }

    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setDone(true);
      setTimeout(() => setLocation("/login"), 3000);
    } catch {
      setError("خطأ في الشبكة، يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#030305] flex items-center justify-center p-4 overflow-hidden">

      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-sm">

        <div className="flex flex-col items-center mb-8">
          <img
            src="/bidreel-admin/logo-icon.png"
            alt="BidReel"
            className="w-20 h-20 rounded-2xl mb-5 box-glow"
          />
          <h1 className="text-2xl font-display font-bold text-white text-center">تعيين كلمة مرور جديدة</h1>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-4 p-6 bg-card/60 border border-border rounded-2xl text-center" dir="rtl">
            <CheckCircle2 size={40} className="text-green-400" />
            <div>
              <p className="text-white font-semibold">تم تغيير كلمة المرور</p>
              <p className="text-sm text-muted-foreground mt-1">سيتم توجيهك لتسجيل الدخول…</p>
            </div>
          </div>
        ) : !sessionReady ? (
          <div className="flex flex-col items-center gap-4 p-6 bg-card/60 border border-border rounded-2xl text-center" dir="rtl">
            <AlertCircle size={32} className="text-destructive" />
            <div>
              <p className="text-white font-semibold">رابط غير صالح أو منتهي الصلاحية</p>
              <p className="text-sm text-muted-foreground mt-1">يرجى طلب رابط استعادة جديد</p>
            </div>
            <button
              onClick={() => setLocation("/forgot-password")}
              className="text-sm text-primary hover:text-primary/80 transition-colors"
            >
              طلب رابط جديد
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground font-medium text-right">
                كلمة المرور الجديدة
              </label>
              <div className="relative">
                <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }}
                  autoComplete="new-password"
                  dir="ltr"
                  required
                  minLength={8}
                  className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 pr-11 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground font-medium text-right">
                تأكيد كلمة المرور
              </label>
              <div className="relative">
                <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="password"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setError(null); }}
                  autoComplete="new-password"
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
              disabled={loading || !password || !confirm}
              className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  جارٍ الحفظ…
                </>
              ) : (
                "حفظ كلمة المرور"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
