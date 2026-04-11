import { useState, useEffect } from "react";
import { Loader2, Lock, CheckCircle2, AlertCircle, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AdminLayout } from "@/components/layout/AdminLayout";

export default function AccountSettings() {
  const [email, setEmail] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) setEmail(session.user.email);
    });
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("كلمتا المرور الجديدة غير متطابقتين");
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

      if (signInError) {
        setError("كلمة المرور الحالية غير صحيحة");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("خطأ في الشبكة، يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminLayout title="إعدادات الحساب">
      <div className="max-w-lg mx-auto space-y-6" dir="rtl">

        {/* Account info card */}
        <div className="bg-card border border-card-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <User size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">معلومات الحساب</p>
              <p className="text-xs text-muted-foreground">حساب المدير</p>
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground mb-0.5">البريد الإلكتروني</p>
            <p className="text-sm text-white font-medium" dir="ltr">{email || "—"}</p>
          </div>
        </div>

        {/* Change password card */}
        <div className="bg-card border border-card-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Lock size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">تغيير كلمة المرور</p>
              <p className="text-xs text-muted-foreground">أدخل كلمة المرور الحالية ثم الجديدة</p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground font-medium">كلمة المرور الحالية</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => { setCurrentPassword(e.target.value); setError(null); setSuccess(false); }}
                autoComplete="current-password"
                dir="ltr"
                required
                className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3 text-white text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground font-medium">كلمة المرور الجديدة</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setError(null); setSuccess(false); }}
                autoComplete="new-password"
                dir="ltr"
                required
                minLength={8}
                className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3 text-white text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
              />
              <p className="text-xs text-muted-foreground">8 أحرف على الأقل</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground font-medium">تأكيد كلمة المرور الجديدة</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null); setSuccess(false); }}
                autoComplete="new-password"
                dir="ltr"
                required
                className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3 text-white text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/60 transition"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3.5 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2.5 p-3.5 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm">
                <CheckCircle2 size={16} className="shrink-0" />
                <span>تم تغيير كلمة المرور بنجاح</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !currentPassword || !newPassword || !confirmPassword}
              className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold rounded-xl py-3 transition-colors flex items-center justify-center gap-2 mt-1"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  جارٍ الحفظ…
                </>
              ) : (
                "حفظ كلمة المرور الجديدة"
              )}
            </button>
          </form>
        </div>

      </div>
    </AdminLayout>
  );
}
