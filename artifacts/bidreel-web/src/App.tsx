import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { useFcmToken } from "@/hooks/use-fcm-token";

// Core user pages — loaded eagerly (always needed)
import Splash from "@/pages/splash";
import Login from "@/pages/login";
import Feed from "@/pages/feed";
import Explore from "@/pages/explore";
import AuctionDetail from "@/pages/auction-detail";
import CreateAuction from "@/pages/create-auction";
import Profile from "@/pages/profile";
import PublicProfilePage from "@/pages/public-profile";
import Interests from "@/pages/interests";
import NotFound from "@/pages/not-found";
import PrivacyPolicy from "@/pages/privacy";

// Admin pages — lazy loaded (most users never access these)
const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminUsers     = lazy(() => import("@/pages/admin/Users"));
const AdminAuctions  = lazy(() => import("@/pages/admin/Auctions"));
const AdminReports   = lazy(() => import("@/pages/admin/Reports"));
const AdminStats     = lazy(() => import("@/pages/admin/Stats"));
const AdminActions   = lazy(() => import("@/pages/admin/AdminActions"));

// AdminGuard stays eagerly loaded — it's a small auth wrapper
import { AdminGuard } from "@/pages/admin/AdminGuard";

const queryClient = new QueryClient();

function AdminPage({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
        {children}
      </Suspense>
    </AdminGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={Splash} />
      <Route path="/feed" component={Feed} />
      <Route path="/explore" component={Explore} />
      <Route path="/auction/:id" component={AuctionDetail} />
      <Route path="/create" component={CreateAuction} />
      <Route path="/profile" component={Profile} />
      <Route path="/users/:userId" component={PublicProfilePage} />
      <Route path="/interests" component={Interests} />
      <Route path="/privacy" component={PrivacyPolicy} />

      <Route path="/admin">
        {() => <AdminPage><AdminDashboard /></AdminPage>}
      </Route>
      <Route path="/admin/users">
        {() => <AdminPage><AdminUsers /></AdminPage>}
      </Route>
      <Route path="/admin/auctions">
        {() => <AdminPage><AdminAuctions /></AdminPage>}
      </Route>
      <Route path="/admin/reports">
        {() => <AdminPage><AdminReports /></AdminPage>}
      </Route>
      <Route path="/admin/stats">
        {() => <AdminPage><AdminStats /></AdminPage>}
      </Route>
      <Route path="/admin/actions">
        {() => <AdminPage><AdminActions /></AdminPage>}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function FcmInit() {
  useFcmToken();
  return null;
}

function App() {
  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <NotificationBannerProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <FcmInit />
              <Router />
            </WouterRouter>
            <Toaster />
          </NotificationBannerProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

export default App;
