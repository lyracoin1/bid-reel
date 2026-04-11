import { useState } from "react";
import { useLocation } from "wouter";
import { Shield, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center shadow-xl shadow-violet-600/30 mb-4">
            <Shield size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">BidReel Admin</h1>
          <p className="text-sm text-gray-500 mt-1">تسجيل دخول لوحة الإدارة</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5" dir="rtl">
              رقم الهاتف (مع كود الدولة)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+20XXXXXXXXXX"
              dir="ltr"
              required
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5" dir="rtl">
              كود الإدارة
            </label>
            <div className="relative">
              <input
                type={showCode ? "text" : "password"}
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="••••••"
                required
                className="w-full px-4 py-3 pr-11 bg-gray-900 border border-gray-700 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition"
              />
              <button
                type="button"
                onClick={() => setShowCode(!showCode)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showCode ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm" dir="rtl">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !phone.trim() || !code.trim()}
            className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-violet-600/20 mt-2"
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

        <p className="text-center text-xs text-gray-700 mt-6">
          BidReel Admin Panel · admin.bid-reel.com
        </p>
      </div>
    </div>
  );
}
