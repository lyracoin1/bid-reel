import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { useFcmToken } from "@/hooks/use-fcm-token";
import { supabase } from "@/lib/supabase";
import { setToken, clearToken, API_BASE } from "@/lib/api-client";
import { CapApp, isNative, OAUTH_SCHEME } from "@/lib/capacitor-app";

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
 * Detected at module-load time (before Supabase can clear the URL) so we know
 * whether the current page load is an OAuth callback redirect.
 *
 * PKCE flow:  Supabase appends ?code=... to the redirect URL.
 * Implicit flow: Supabase appends #access_token=... to the hash.
 */
const _isOAuthCallback =
  typeof window !== "undefined" &&
  (window.location.search.includes("code=") ||
    window.location.hash.includes("access_token="));

/**
 * Onboarding guard — profile completeness is enforced at the action level
 * (e.g. create-auction page), NOT globally here.
 *
 * Existing users with incomplete profiles (e.g. missing the location field
 * added in migration 023) enter the app normally and are only blocked when
 * they attempt a restricted action such as creating an auction.
 *
 * New users are routed to /interests by login.tsx afterSignIn / OAuthCallbackHandler
 * based on the isNewUser flag returned by POST /auth/ensure-profile.
 */
function OnboardingGuard({ children }: { children: React.ReactNode }) {
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

/**
 * Handles the OAuth redirect callback (Google Sign-In and any future OAuth provider).
 *
 * When the user is redirected back from the OAuth provider, Supabase appends
 * OAuth tokens / codes to the URL.  We detect this at module load time (_isOAuthCallback)
 * before Supabase clears the URL, then subscribe to the first SIGNED_IN or
 * INITIAL_SESSION event to obtain the session and run the standard afterSignIn flow
 * (ensure-profile → redirect to /interests or /feed).
 *
 * Must be rendered inside <WouterRouter> so useLocation is available.
 */
function OAuthCallbackHandler() {
  const [, setWouterLocation] = useLocation();
  const handled = useRef(false);

  useEffect(() => {
    if (!_isOAuthCallback || handled.current || !supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session && !handled.current) {
          handled.current = true;
          subscription.unsubscribe();

          setToken(session.access_token);

          try {
            const res = await fetch(`${API_BASE}/auth/ensure-profile`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
            });
            if (res.ok) {
              const data = await res.json() as { isNewUser: boolean; user: { isCompleted: boolean } };
              const isNewUser = data.isNewUser ?? false;
              const isComplete = data.user?.isCompleted ?? false;
              // Only route genuinely new users to /interests for onboarding.
              // Existing users (even with an incomplete profile) go to /feed —
              // missing fields are enforced at the action level (create-auction).
              setWouterLocation(isNewUser && !isComplete ? "/interests" : "/feed");
            } else {
              // Ensure-profile failed — let the user into the app anyway.
              setWouterLocation("/feed");
            }
          } catch {
            setWouterLocation("/feed");
          }
        }
      },
    );

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * Handles the OAuth deep-link return inside the Capacitor Android app.
 *
 * Flow:
 *   1. User taps "Sign in with Google" → signInWithOAuth redirects the WebView
 *      to Supabase's auth endpoint, which opens Google in a Chrome Custom Tab.
 *   2. Google auth completes → Chrome redirects to com.bidreel.app://auth/callback
 *      with either ?code= (PKCE) or #access_token= (implicit) in the URL.
 *   3. Android routes the custom-scheme intent to MainActivity (single-task) and
 *      Capacitor fires the "appUrlOpen" event on the JS bridge.
 *   4. This handler receives the URL, exchanges the code / sets the session,
 *      calls ensure-profile, then navigates to /interests (new user) or /feed.
 *
 * getLaunchUrl() also handles the cold-start case where the app was killed and
 * then relaunched directly from the OAuth redirect intent.
 *
 * Only mounted on native platforms (isNative() === false → early return).
 */
function CapacitorOAuthHandler() {
  const [, setWouterLocation] = useLocation();
  const handled = useRef(false);

  useEffect(() => {
    if (!isNative() || !supabase) return;

    let mounted = true;

    async function handleUrl(url: string) {
      if (!url.startsWith(OAUTH_SCHEME + "://")) return;
      if (handled.current || !supabase) return;
      handled.current = true;

      console.log("[CapacitorOAuth] Deep link received:", url);

      try {
        // Normalise: replace the custom scheme with https so URL() can parse it.
        const parsed = new URL(url.replace(OAUTH_SCHEME + "://", "https://placeholder.invalid/"));
        let session: { access_token: string; refresh_token: string } | null = null;

        // ── PKCE flow: ?code=... ─────────────────────────────────────────────
        const code = parsed.searchParams.get("code");
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[CapacitorOAuth] PKCE exchange failed:", error.message);
          } else if (data.session) {
            session = data.session;
          }
        }

        // ── Implicit flow: #access_token=...&refresh_token=... ───────────────
        if (!session) {
          const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
          const params = new URLSearchParams(hash);
          const at = params.get("access_token");
          const rt = params.get("refresh_token");
          if (at && rt) {
            const { data, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
            if (error) {
              console.error("[CapacitorOAuth] Session set failed:", error.message);
            } else if (data.session) {
              session = data.session;
            }
          }
        }

        if (!session || !mounted) return;
        setToken(session.access_token);
        console.log("[CapacitorOAuth] Session established — calling ensure-profile");

        // ── ensure-profile → route (same logic as OAuthCallbackHandler) ─────
        try {
          const res = await fetch(`${API_BASE}/auth/ensure-profile`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
          });
          if (res.ok) {
            const data = await res.json() as { isNewUser: boolean; user: { isCompleted: boolean } };
            const isNewUser = data.isNewUser ?? false;
            const isComplete = data.user?.isCompleted ?? false;
            if (mounted) setWouterLocation(isNewUser && !isComplete ? "/interests" : "/feed");
          } else {
            if (mounted) setWouterLocation("/feed");
          }
        } catch {
          if (mounted) setWouterLocation("/feed");
        }
      } catch (err) {
        console.error("[CapacitorOAuth] Deep link processing error:", err);
        handled.current = false;
      }
    }

    // ── Cold start: app was killed, relaunched via the deep link intent ──────
    CapApp.getLaunchUrl()
      .then(({ url }) => { if (url) handleUrl(url); })
      .catch(() => {});

    // ── Warm start: app in background, brought to foreground via deep link ───
    const listenerHandle = CapApp.addListener("appUrlOpen", ({ url }) => handleUrl(url));

    return () => {
      mounted = false;
      listenerHandle.then(h => h.remove()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <OAuthCallbackHandler />
              <CapacitorOAuthHandler />
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
