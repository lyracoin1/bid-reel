import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { isAdminSessionValid } from "@/lib/admin-session";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import Auctions from "@/pages/Auctions";
import Reports from "@/pages/Reports";
import Stats from "@/pages/Stats";
import Actions from "@/pages/Actions";
import NotFound from "@/pages/not-found";

function AdminGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAdminSessionValid()) {
      setLocation("/login");
    }
  }, [setLocation]);

  if (!isAdminSessionValid()) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={28} className="text-violet-500 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
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
