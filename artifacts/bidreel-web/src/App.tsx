import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { useFcmToken } from "@/hooks/use-fcm-token";
import { supabase } from "@/lib/supabase";
import { setToken, clearToken } from "@/lib/api-client";

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

const queryClient = new QueryClient();

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

      <Route component={NotFound} />
    </Switch>
  );
}

function FcmInit() {
  useFcmToken();
  return null;
}

/** Keeps the api-client Bearer token in sync with Supabase session refreshes. */
function AuthSync() {
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setToken(session.access_token);
      } else {
        clearToken();
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}

function App() {
  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <NotificationBannerProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthSync />
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
