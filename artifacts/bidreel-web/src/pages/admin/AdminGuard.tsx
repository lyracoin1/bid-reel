/**
 * AdminGuard
 *
 * Single-gate protection for all /admin/* routes.
 *
 * Access model (the ONLY valid path to admin):
 *   1. user.isAdmin === true  (DB flag — set only by POST /api/auth/admin-login)
 *   2. bidreel_admin_ts is present and < 15 min old (set only by afterAdminLogin
 *      in login.tsx immediately after the admin login form succeeds)
 *
 * Any other entry attempt is rejected:
 *   - Not an admin user               → /feed
 *   - Admin user, no valid session     → /login  (must re-enter via admin form)
 *
 * The former password-gate UI and POST /api/admin/verify-password endpoint
 * have been permanently removed — they constituted a second, unintended
 * admin-entry path that bypassed the dedicated admin login flow.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAdminSessionValid } from "./admin-session";

interface AdminGuardProps {
  children: React.ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { user, isLoading } = useCurrentUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user?.isAdmin) {
      setLocation("/feed");
      return;
    }
    if (!isAdminSessionValid()) {
      setLocation("/login");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading || !user?.isAdmin || !isAdminSessionValid()) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={28} className="text-violet-500 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
