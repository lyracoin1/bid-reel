import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { useFcmToken } from "@/hooks/use-fcm-token";

// User pages
import Splash from "@/pages/splash";
import Login from "@/pages/login";
import Feed from "@/pages/feed";
import Explore from "@/pages/explore";
import AuctionDetail from "@/pages/auction-detail";
import CreateAuction from "@/pages/create-auction";
import Profile from "@/pages/profile";
import Interests from "@/pages/interests";
import NotFound from "@/pages/not-found";

// Admin pages
import { AdminGuard } from "@/pages/admin/AdminGuard";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminUsers from "@/pages/admin/Users";
import AdminAuctions from "@/pages/admin/Auctions";
import AdminReports from "@/pages/admin/Reports";
import AdminStats from "@/pages/admin/Stats";
import AdminActions from "@/pages/admin/AdminActions";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Auth routes */}
      <Route path="/login" component={Login} />

      {/* User routes */}
      <Route path="/" component={Splash} />
      <Route path="/feed" component={Feed} />
      <Route path="/explore" component={Explore} />
      <Route path="/auction/:id" component={AuctionDetail} />
      <Route path="/create" component={CreateAuction} />
      <Route path="/profile" component={Profile} />
      <Route path="/interests" component={Interests} />

      {/* Admin routes — all guarded */}
      <Route path="/admin">
        {() => <AdminGuard><AdminDashboard /></AdminGuard>}
      </Route>
      <Route path="/admin/users">
        {() => <AdminGuard><AdminUsers /></AdminGuard>}
      </Route>
      <Route path="/admin/auctions">
        {() => <AdminGuard><AdminAuctions /></AdminGuard>}
      </Route>
      <Route path="/admin/reports">
        {() => <AdminGuard><AdminReports /></AdminGuard>}
      </Route>
      <Route path="/admin/stats">
        {() => <AdminGuard><AdminStats /></AdminGuard>}
      </Route>
      <Route path="/admin/actions">
        {() => <AdminGuard><AdminActions /></AdminGuard>}
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <FcmInit />
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

export default App;
