import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { adminLogin } from "@/services/admin-api";
import { setAdminSession } from "@/lib/admin-session";

export default function Login() {
  const [, setLocation] = useLocation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await adminLogin(phone.trim(), code.trim());
      setAdminSession(token);
      setLocation("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#030305] flex items-center justify-center p-4 overflow-hidden">

      {/* Ambient glow — exact same orbs as main app login */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-sm">

        {/* Logo + heading */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/bidreel-admin/logo-icon.png"
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
              رقم الهاتف (مع كود الدولة)
            </label>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={e => { setPhone(e.target.value); setError(null); }}
              placeholder="+20XXXXXXXXXX"
              autoComplete="tel"
              dir="ltr"
              required
              className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground font-medium text-right">
              كود الإدارة
            </label>
            <div className="relative">
              <input
                type={showCode ? "text" : "password"}
                value={code}
                onChange={e => { setCode(e.target.value); setError(null); }}
                placeholder="أدخل الكود السري"
                autoComplete="off"
                required
                className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3.5 pr-12 text-white text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
              />
              <button
                type="button"
                onClick={() => setShowCode(!showCode)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
              >
                {showCode ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
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
            disabled={loading || !phone.trim() || !code.trim()}
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
