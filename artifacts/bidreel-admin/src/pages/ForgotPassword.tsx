import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: "https://admin.bid-reel.com/reset-password" },
      );

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setSent(true);
    } catch {
      setError("خطأ في الشبكة، يرجى التحقق من اتصالك");
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
            src={`${import.meta.env.BASE_URL}logo-icon.png`}
            alt="BidReel"
            className="w-20 h-20 rounded-2xl mb-5 box-glow"
          />
          <h1 className="text-2xl font-display font-bold text-white text-center">استعادة كلمة المرور</h1>
          <p className="text-sm text-muted-foreground text-center mt-1.5">
            أدخل بريدك الإلكتروني وسنرسل لك رابط الاستعادة
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-4 p-6 bg-card/60 border border-border rounded-2xl text-center" dir="rtl">
            <CheckCircle2 size={40} className="text-green-400" />
            <div>
              <p className="text-white font-semibold">تم إرسال الرابط</p>
              <p className="text-sm text-muted-foreground mt-1">
                تحقق من بريدك الإلكتروني واتبع الرابط لإعادة تعيين كلمة المرور
              </p>
            </div>
            <button
              onClick={() => setLocation("/login")}
              className="text-sm text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
            >
              العودة لتسجيل الدخول
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
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

            {error && (
              <div className="flex items-start gap-2.5 p-3.5 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm" dir="rtl">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  جارٍ الإرسال…
                </>
              ) : (
                "إرسال رابط الاستعادة"
              )}
            </button>

            <button
              type="button"
              onClick={() => setLocation("/login")}
              className="text-sm text-muted-foreground hover:text-white transition-colors text-center"
            >
              العودة لتسجيل الدخول
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
