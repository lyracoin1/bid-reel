import { lazy, Suspense, useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { useFcmToken } from "@/hooks/use-fcm-token";
import { useAndroidBack } from "@/hooks/use-android-back";
import { supabase } from "@/lib/supabase";
import { setToken, clearToken, API_BASE } from "@/lib/api-client";
import { CapApp, isNative, OAUTH_SCHEME, closeBrowser } from "@/lib/capacitor-app";
import { Browser } from "@capacitor/browser";
import { installAudioIntentListener } from "@/lib/global-mute";

// ── Critical path — loaded eagerly (needed on first paint) ───────────────────
// Splash is the entry point, Login is always reachable from Splash, and Feed
// is the primary surface. These three must never be behind a lazy boundary.
import Splash from "@/pages/splash";
import Login from "@/pages/login";
import Feed from "@/pages/feed";
import NotFound from "@/pages/not-found";

// ── Secondary routes — loaded lazily (code split on demand) ─────────────────
// Each lazy() call tells Vite to emit a separate JS chunk for that page.
// The chunk is fetched from cache (or network) only when the user navigates
// there, so it never adds to the cold-start parse budget.
const Explore          = lazy(() => import("@/pages/explore"));
const AuctionDetail    = lazy(() => import("@/pages/auction-detail"));
const CreateAuction    = lazy(() => import("@/pages/create-auction"));
const Profile          = lazy(() => import("@/pages/profile"));
const ProfileEdit      = lazy(() => import("@/pages/profile-edit"));
const PublicProfilePage = lazy(() => import("@/pages/public-profile"));
const Interests        = lazy(() => import("@/pages/interests"));
const SafetyRules      = lazy(() => import("@/pages/safety-rules"));
const ChangePassword   = lazy(() => import("@/pages/change-password"));
const PrivacyPolicy    = lazy(() => import("@/pages/privacy"));
const MyDealsPage          = lazy(() => import("@/pages/my-deals"));
const DealDetailPage       = lazy(() => import("@/pages/deal-detail"));
const PaymentProtectionPage  = lazy(() => import("@/pages/payment-protection"));
const SubscriptionPage        = lazy(() => import("@/pages/subscription"));
const SecureDealCreatePage    = lazy(() => import("@/pages/secure-deal-create"));
const SecureDealPayPage       = lazy(() => import("@/pages/secure-deal-pay"));
const ChildSafetyPage         = lazy(() => import("@/pages/child-safety"));

// ── Suspense fallback — shown during lazy chunk fetch ────────────────────────
// Minimal spinner that matches the app's dark background, keeping the
// transition from Feed visually seamless.
function PageLoader() {
  return (
    <div className="w-full h-[100dvh] flex items-center justify-center bg-background">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30 s — data is fresh; skip background refetch
      refetchOnWindowFocus: false, // don't refetch when the tab regains focus
      refetchOnMount: false,       // don't refetch when a component re-mounts with cached data
      retry: 1,                    // one retry on failure is enough
    },
  },
});

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
      {/* Suspense boundary covers all lazy-loaded page chunks.
          The fallback spinner is shown only for the brief moment (usually
          <100 ms on a warm cache, <500 ms on first visit) while the chunk
          for a secondary page is fetched and parsed. */}
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/" component={Splash} />
          <Route path="/feed" component={Feed} />
          <Route path="/explore" component={Explore} />
          <Route path="/auction/:id" component={AuctionDetail} />
          <Route path="/create" component={CreateAuction} />
          <Route path="/profile" component={Profile} />
          <Route path="/profile/edit" component={ProfileEdit} />
          <Route path="/users/:userId" component={PublicProfilePage} />
          <Route path="/interests" component={Interests} />
          <Route path="/safety-rules" component={SafetyRules} />
          <Route path="/change-password" component={ChangePassword} />
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route path="/deals" component={MyDealsPage} />
          <Route path="/deals/:dealId" component={DealDetailPage} />
          <Route path="/payment-protection" component={PaymentProtectionPage} />
          <Route path="/subscription" component={SubscriptionPage} />
          <Route path="/secure-deals/create" component={SecureDealCreatePage} />
          <Route path="/secure-deals/pay/:dealId" component={SecureDealPayPage} />
          <Route path="/child-safety" component={ChildSafetyPage} />

          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </OnboardingGuard>
  );
}

function FcmInit() {
  useFcmToken();
  return null;
}

/**
 * Centralised Android hardware-back-button policy. No-op on web.
 *
 *   1. Close any open overlay (modal/sheet/drawer/lightbox) first
 *   2. Inner page → wouter setLocation(parent, { replace: true })
 *   3. Root tab    → double-tap to exit via App.exitApp()
 *   4. Unknown     → wouter setLocation("/feed", { replace: true })
 *
 * Mounted ONCE inside <WouterRouter> so useLocation is available.
 */
function AndroidBackPolicy() {
  useAndroidBack();
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
              // REPLACE — OAuth callback URL (?code=…) must NEVER stay in history.
              setWouterLocation(isNewUser && !isComplete ? "/interests" : "/feed", { replace: true });
            } else {
              // Ensure-profile failed — let the user into the app anyway.
              setWouterLocation("/feed", { replace: true });
            }
          } catch {
            setWouterLocation("/feed", { replace: true });
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
  // Track the last URL we *started* processing to guard against the same URL
  // being delivered twice (getLaunchUrl + appUrlOpen both firing for the same
  // cold-start intent).  Using a URL string rather than a plain boolean means
  // a NEW OAuth URL (second sign-in after sign-out) is always processed, not
  // silently swallowed by a stale "already handled" flag.
  const lastProcessedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!isNative() || !supabase) return;

    let mounted = true;

    async function handleUrl(url: string) {
      console.log("[CapacitorOAuth] handleUrl called with:", url);
      if (!url.startsWith(OAUTH_SCHEME + "://")) {
        console.log("[CapacitorOAuth] URL does not match scheme — ignoring");
        return;
      }
      if (lastProcessedUrl.current === url) {
        console.log("[CapacitorOAuth] Same URL already being processed — ignoring duplicate");
        return;
      }
      if (!supabase) {
        console.error("[CapacitorOAuth] Supabase client not available");
        return;
      }
      lastProcessedUrl.current = url;

      // Dismiss the Chrome Custom Tab immediately so the user sees the app
      // (not a blank/loading Custom Tab) while the code exchange is in flight.
      console.log("[CapacitorOAuth] Closing Custom Tab…");
      closeBrowser();

      console.log("[CapacitorOAuth] Deep link received:", url);

      try {
        // Normalise: replace the custom scheme with https so URL() can parse it.
        const normalised = url.replace(OAUTH_SCHEME + "://", "https://placeholder.invalid/");
        console.log("[CapacitorOAuth] Normalised URL for parsing:", normalised);
        const parsed = new URL(normalised);
        let session: { access_token: string; refresh_token: string } | null = null;

        // ── PKCE flow: ?code=... ─────────────────────────────────────────────
        // Pass the full normalised URL — the SDK extracts the code internally
        // and also retrieves the code_verifier from storage via the same path.
        // Passing just the raw code string is fragile across SDK versions.
        const code = parsed.searchParams.get("code");
        console.log("[CapacitorOAuth] PKCE code present:", !!code);
        if (code) {
          console.log("[CapacitorOAuth] Attempting exchangeCodeForSession (full URL)…");
          const { data, error } = await supabase.auth.exchangeCodeForSession(normalised);
          if (error) {
            console.error("[CapacitorOAuth] PKCE exchange failed:", error.message, error);
          } else if (data.session) {
            console.log("[CapacitorOAuth] PKCE exchange succeeded — session user:", data.session.user?.email);
            session = data.session;
          } else {
            console.warn("[CapacitorOAuth] PKCE exchange returned no error and no session");
          }
        }

        // ── Implicit flow: #access_token=...&refresh_token=... ───────────────
        if (!session) {
          const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
          const params = new URLSearchParams(hash);
          const at = params.get("access_token");
          const rt = params.get("refresh_token");
          console.log("[CapacitorOAuth] Implicit flow — access_token present:", !!at, "refresh_token present:", !!rt);
          if (at && rt) {
            console.log("[CapacitorOAuth] Attempting setSession (implicit)…");
            const { data, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
            if (error) {
              console.error("[CapacitorOAuth] Session set failed:", error.message, error);
            } else if (data.session) {
              console.log("[CapacitorOAuth] Implicit session set — user:", data.session.user?.email);
              session = data.session;
            } else {
              console.warn("[CapacitorOAuth] setSession returned no error and no session");
            }
          }
        }

        if (!session) {
          console.error("[CapacitorOAuth] Could not establish session from deep link URL — no code and no tokens found");
          // Navigate to login so the user gets visual feedback.
          // The next Google sign-in attempt will have a different URL (new PKCE
          // code), so the URL-based dedup guard won't block it.
          // REPLACE — never leave the deep-link callback URL in history.
          if (mounted) setWouterLocation("/login", { replace: true });
          return;
        }
        if (!mounted) {
          console.warn("[CapacitorOAuth] Component unmounted before navigation — aborting");
          return;
        }
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
          console.log("[CapacitorOAuth] ensure-profile response status:", res.status);
          if (res.ok) {
            const data = await res.json() as { isNewUser: boolean; user: { isCompleted: boolean } };
            const isNewUser = data.isNewUser ?? false;
            const isComplete = data.user?.isCompleted ?? false;
            const dest = isNewUser && !isComplete ? "/interests" : "/feed";
            console.log("[CapacitorOAuth] Navigating to:", dest, "| isNewUser:", isNewUser, "| isComplete:", isComplete);
            // REPLACE — back from /feed must not return to the OAuth deep-link URL.
            if (mounted) setWouterLocation(dest, { replace: true });
          } else {
            console.warn("[CapacitorOAuth] ensure-profile failed — navigating to /feed anyway");
            if (mounted) setWouterLocation("/feed", { replace: true });
          }
        } catch (err) {
          console.error("[CapacitorOAuth] ensure-profile network error:", err, "— navigating to /feed");
          if (mounted) setWouterLocation("/feed", { replace: true });
        }
      } catch (err) {
        console.error("[CapacitorOAuth] Deep link processing error:", err);
        // Unexpected error — navigate to login so the user is not frozen.
        if (mounted) setWouterLocation("/login", { replace: true });
      }
    }

    // ── Cold start: app was killed, relaunched via the deep link intent ──────
    console.log("[CapacitorOAuth] Mounted — checking getLaunchUrl…");
    CapApp.getLaunchUrl()
      .then((result) => {
        const url = result?.url;
        console.log("[CapacitorOAuth] getLaunchUrl result:", url ?? "(null)");
        if (url) handleUrl(url);
      })
      .catch(err => console.warn("[CapacitorOAuth] getLaunchUrl error:", err));

    // ── Warm start: app in background, brought to foreground via deep link ───
    // Primary path: appUrlOpen fires when MainActivity receives onNewIntent.
    console.log("[CapacitorOAuth] Registering appUrlOpen listener…");
    const listenerHandle = CapApp.addListener("appUrlOpen", ({ url }) => {
      console.log("[CapacitorOAuth] appUrlOpen fired with:", url);
      handleUrl(url);
    });

    // ── Fallback: browserFinished + getLaunchUrl ──────────────────────────────
    // When a Chrome Custom Tab closes, @capacitor/browser fires "browserFinished".
    // On some Android versions / Chrome builds, appUrlOpen can be delivered
    // AFTER the WebView resumes rather than synchronously with onNewIntent.
    // As a belt-and-suspenders guard: when the Custom Tab finishes, wait a
    // brief moment for appUrlOpen to arrive normally, then read getLaunchUrl().
    // In singleTask mode, getActivity().getIntent() is updated by Android when
    // onNewIntent fires, so getLaunchUrl() returns the OAuth callback URL even
    // in warm-start scenarios.  The URL-based dedup in handleUrl prevents
    // double-processing if appUrlOpen already ran.
    const browserFinishedHandle = Browser.addListener("browserFinished", () => {
      console.log("[CapacitorOAuth] browserFinished — checking getLaunchUrl as fallback…");
      setTimeout(() => {
        CapApp.getLaunchUrl()
          .then(result => {
            const url = result?.url;
            console.log("[CapacitorOAuth] browserFinished → getLaunchUrl:", url ?? "(null)");
            if (url) handleUrl(url);
          })
          .catch(err => console.warn("[CapacitorOAuth] browserFinished → getLaunchUrl error:", err));
      }, 300); // 300 ms lets appUrlOpen arrive first if it will
    });

    return () => {
      mounted = false;
      listenerHandle.then(h => h.remove()).catch(() => {});
      browserFinishedHandle.then(h => h.remove()).catch(() => {});
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

// Install the global "first user interaction → unmute" listener as soon as
// the JS module loads. Idempotent — calling more than once is a no-op.
installAudioIntentListener();

function App() {
  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <NotificationBannerProvider>
            <WouterRouter base={(import.meta.env.BASE_URL ?? "").replace(/\/$/, "")}>
              <AuthSync />
              <FcmInit />
              <AndroidBackPolicy />
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
