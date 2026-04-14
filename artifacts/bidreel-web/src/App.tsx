import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { useFcmToken } from "@/hooks/use-fcm-token";
import { supabase } from "@/lib/supabase";
import { setToken, clearToken } from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/use-current-user";

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

/**
 * Profile completeness gate — enforced at the app routing level.
 *
 * If the current user is loaded and their profile is incomplete (missing any
 * of: username, display_name, phone, avatar_url), they are redirected to
 * /interests to complete onboarding regardless of which route they tried to
 * access. This prevents bypassing onboarding via direct URL, app reload, or
 * manipulating the hasSeenInterests localStorage flag.
 *
 * Public routes (splash, login, interests, privacy) are excluded from the gate
 * so the user can actually complete their profile and log out.
 */
const PUBLIC_PATHS = new Set(["/", "/login", "/interests", "/privacy"]);

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useCurrentUser();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    if (PUBLIC_PATHS.has(location)) return;

    if (!user.isCompleted) {
      // Clear the interests-seen flag so they go through the full onboarding flow
      localStorage.removeItem("hasSeenInterests");
      setLocation("/interests");
    }
  }, [user, isLoading, location, setLocation]);

  return <>{children}</>;
}

function Router() {
  return (
    <OnboardingGuard>
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
    </OnboardingGuard>
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        // New or refreshed session — store the latest access token.
        setToken(session.access_token);
      } else if (event === "SIGNED_OUT") {
        // Explicit sign-out only — clear the token and cached profile.
        // Do NOT clear on INITIAL_SESSION with null (Supabase fires this while
        // checking storage) or TOKEN_REFRESH_ERROR — those are transient states
        // and the getToken() fallback will attempt a Supabase session refresh.
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
