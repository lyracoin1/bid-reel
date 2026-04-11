import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import Auctions from "@/pages/Auctions";
import Reports from "@/pages/Reports";
import Stats from "@/pages/Stats";
import Actions from "@/pages/Actions";
import AccountSettings from "@/pages/AccountSettings";
import NotFound from "@/pages/not-found";

function AdminGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        if (!cancelled) { setStatus("denied"); setLocation("/login"); }
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (profile?.is_admin) {
        setStatus("ok");
      } else {
        await supabase.auth.signOut();
        setStatus("denied");
        setLocation("/login");
      }
    }

    checkAuth();
    return () => { cancelled = true; };
  }, [setLocation]);

  if (status === "loading") {
    return (
      <div className="h-screen bg-[#030305] flex items-center justify-center">
        <Loader2 size={28} className="text-primary animate-spin" />
      </div>
    );
  }

  if (status === "denied") return null;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/">
        <AdminGuard><Dashboard /></AdminGuard>
      </Route>
      <Route path="/users">
        <AdminGuard><Users /></AdminGuard>
      </Route>
      <Route path="/auctions">
        <AdminGuard><Auctions /></AdminGuard>
      </Route>
      <Route path="/reports">
        <AdminGuard><Reports /></AdminGuard>
      </Route>
      <Route path="/stats">
        <AdminGuard><Stats /></AdminGuard>
      </Route>
      <Route path="/actions">
        <AdminGuard><Actions /></AdminGuard>
      </Route>
      <Route path="/account">
        <AdminGuard><AccountSettings /></AdminGuard>
      </Route>
      <Route><NotFound /></Route>
    </Switch>
  );
}

export default function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}
