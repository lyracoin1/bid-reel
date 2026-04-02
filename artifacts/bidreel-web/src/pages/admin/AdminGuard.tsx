/**
 * AdminGuard
 *
 * Wraps admin pages with two layers of protection:
 * 1. user.isAdmin must be true (DB role check)
 * 2. Admin panel password must have been entered this session
 *
 * Session storage key: bidreel_admin_ts
 * Value: ISO timestamp when the password was verified
 * Expiry: 15 minutes — clears on tab close automatically (sessionStorage)
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Eye, EyeOff, Loader2, Shield } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { adminVerifyPassword } from "@/lib/admin-api";

const SESSION_KEY = "bidreel_admin_ts";
const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function isAdminSessionValid(): boolean {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < SESSION_DURATION_MS;
}

export function setAdminSession(): void {
  sessionStorage.setItem(SESSION_KEY, String(Date.now()));
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

interface AdminGuardProps {
  children: React.ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { user, isLoading } = useCurrentUser();
  const [, setLocation] = useLocation();

  const [passwordVerified, setPasswordVerified] = useState(() => isAdminSessionValid());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Still loading user
  if (isLoading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={28} className="text-violet-500 animate-spin" />
      </div>
    );
  }

  // Not an admin — redirect
  if (!user?.isAdmin) {
    setLocation("/feed");
    return null;
  }

  // Admin but password not yet verified this session
  if (!passwordVerified) {
    const handleVerify = async () => {
      if (!password) return;
      setVerifying(true);
      setError(null);
      try {
        await adminVerifyPassword(password);
        setAdminSession();
        setPasswordVerified(true);
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? "Incorrect password");
      } finally {
        setVerifying(false);
      }
    };

    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">

          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-violet-600/20 border border-violet-600/30 flex items-center justify-center mb-4">
              <Shield size={28} className="text-violet-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Admin Panel</h2>
            <p className="text-sm text-gray-400 mt-1 text-center">
              Enter the admin password to continue
            </p>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                onKeyDown={e => e.key === "Enter" && handleVerify()}
                placeholder="Admin password"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-10 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 text-sm"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-400 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {error}
              </p>
            )}

            <button
              onClick={handleVerify}
              disabled={!password || verifying}
              className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {verifying ? <Loader2 size={16} className="animate-spin" /> : null}
              {verifying ? "Verifying…" : "Enter Admin Panel"}
            </button>

            <button
              onClick={() => setLocation("/feed")}
              className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
