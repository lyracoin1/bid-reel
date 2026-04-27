import { useState, useEffect } from "react";
import {
  Grid, Bookmark, LogOut, ShieldCheck, Trash2, Shield, MapPin,
  Pencil, Settings, ChevronRight, Gavel, Trophy, AlertCircle, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { formatAuctionPrice } from "@/lib/geo";
import { HamburgerMenu } from "@/components/HamburgerMenu";
import { useCurrentUser, clearCurrentUserCache } from "@/hooks/use-current-user";
import { useOverlayBack } from "@/hooks/use-overlay-back";
import { useAuctions, useMyAuctions } from "@/hooks/use-auctions";
import { getSavedIdsApi, clearToken, deleteAccountApi, getBiddedAuctionsApi, type ApiBiddedAuction } from "@/lib/api-client";
import { clearAdminSession } from "@/pages/admin/admin-session";
import { deleteNativeFcmToken } from "@/lib/native-fcm";
import { getTimeRemaining } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { UserAvatar } from "@/components/ui/user-avatar";
import { FollowListModal } from "@/components/FollowListModal";
import { TrustStatCard } from "@/components/trust/TrustBadge";
import { useUserTrust } from "@/hooks/use-user-trust";

type Tab = "my_auctions" | "my_bids" | "saved";
type FollowModal = "followers" | "following" | null;

export default function Profile() {
  const [activeTab, setActiveTab] = useState<Tab>("my_auctions");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedLoading, setSavedLoading] = useState(false);
  const [biddedAuctions, setBiddedAuctions] = useState<ApiBiddedAuction[]>([]);
  const [biddedLoading, setBiddedLoading] = useState(false);
  const [biddedError, setBiddedError] = useState<string | null>(null);
  const [followModal, setFollowModal] = useState<FollowModal>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { t, lang } = useLang();

  // Android hardware back closes overlays in priority order:
  //  - delete-confirm modal (highest priority — destructive action)
  //  - follow-list sheet
  // The HamburgerMenu drawer registers its own handler internally.
  useOverlayBack(showDeleteConfirm, () => setShowDeleteConfirm(false));
  useOverlayBack(followModal !== null, () => setFollowModal(null));

  const { user, isLoading: userLoading } = useCurrentUser();
  const { trust } = useUserTrust(user?.id ?? null);

  async function handleDeleteAccount() {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountApi();
      await deleteNativeFcmToken();
      clearCurrentUserCache();
      clearAdminSession();
      clearToken();
      // REPLACE — account deletion is a hard auth-boundary; back from /login
      // must NEVER return to a profile page for an account that no longer exists.
      setLocation("/login", { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account. Please try again.");
      setIsDeleting(false);
    }
  }

  // My Auctions — dedicated seller-scoped endpoint (excludes only 'removed').
  // Consistent with the auctionCount stat in the profile header (same filter).
  const { data: myListings, isLoading: myAuctionsLoading } = useMyAuctions();

  // Saved tab — still fetched from the global feed for now.
  const { data: allAuctions, isLoading: auctionsLoading } = useAuctions();

  // Load saved IDs lazily when the saved tab is first activated
  useEffect(() => {
    if (activeTab !== "saved") return;
    setSavedLoading(true);
    getSavedIdsApi()
      .then(ids => setSavedIds(new Set(ids)))
      .catch(() => {})
      .finally(() => setSavedLoading(false));
  }, [activeTab]);

  // Load bidded auctions when "مزايداتي" tab is activated. Always re-fetches
  // on tab open so rank/highest-bidder status stays fresh after returning
  // from a bid placement on another screen.
  useEffect(() => {
    if (activeTab !== "my_bids") return;
    setBiddedLoading(true);
    setBiddedError(null);
    getBiddedAuctionsApi()
      .then(rows => setBiddedAuctions(rows))
      .catch(err => setBiddedError(err instanceof Error ? err.message : "Failed to load your bids"))
      .finally(() => setBiddedLoading(false));
  }, [activeTab]);

  const savedAuctions = allAuctions.filter(a => savedIds.has(a.id));

  const tabs: { id: Tab; labelKey: "my_auctions" | "my_bids" | "saved_tab"; icon: typeof Grid; count: number }[] = [
    { id: "my_auctions", labelKey: "my_auctions", icon: Grid,     count: myListings.length },
    { id: "my_bids",     labelKey: "my_bids",     icon: Gavel,    count: biddedAuctions.length },
    { id: "saved",       labelKey: "saved_tab",   icon: Bookmark, count: savedIds.size },
  ];

  const isLoading = userLoading || auctionsLoading || myAuctionsLoading;

  function handleLogout() {
    void deleteNativeFcmToken();
    clearCurrentUserCache();
    clearAdminSession();
    clearToken();
    // REPLACE — logout is a hard auth-boundary; back from /login must NOT
    // return to a now-unauthenticated profile page.
    setLocation("/login", { replace: true });
  }

  // Completeness — backend requires 5 fields (username, display_name, phone,
  // avatar_url, location). `phone` is now returned on ApiUserProfile for the
  // authenticated user's own profile, so we check it directly instead of
  // inferring it from the server-side `isCompleted` flag (which used to be
  // the only signal but would get out of sync with client state).
  const completenessFields = [
    { key: "avatar",   label: t("profile_photo_label"),  done: !!user?.avatarUrl },
    { key: "username", label: t("username_label"),        done: !!user?.username },
    { key: "name",     label: t("display_name_label"),    done: !!user?.displayName },
    { key: "location", label: t("location_label"),        done: !!user?.location },
    { key: "phone",    label: t("phone_required_label"), done: !!user?.phone },
  ];
  const completedCount = completenessFields.filter(f => f.done).length;
  // Drive the progress ring purely off the visible fields. Legacy rows where
  // the server-side `isCompleted` flag is stale (e.g. phone removed after
  // account creation) must still surface the missing field — gating 100%
  // on the field count is the only source of truth the user can act on.
  const completePct    = !user ? 0 : Math.round((completedCount / completenessFields.length) * 100);
  const missingFields  = completenessFields.filter(f => !f.done);

  return (
    <MobileLayout>
      <div className="min-h-full bg-background">

        {/* ── Hero header ── */}
        <div className="relative px-5 pt-14 pb-5 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-primary/12 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex items-start justify-between mb-5">
            {/* Avatar + name */}
            <div className="flex items-center gap-4">
              <div className="relative">
                {isLoading ? (
                  <div className="w-20 h-20 rounded-2xl bg-white/10 animate-pulse" />
                ) : (
                  <UserAvatar
                    src={user?.avatarUrl ?? null}
                    name={user?.displayName ?? "Me"}
                    size={80}
                    className="rounded-2xl ring-2 ring-white/10"
                  />
                )}
                <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-400 border-2 border-background" />
              </div>

              <div>
                {isLoading ? (
                  <>
                    <div className="h-5 w-28 bg-white/10 rounded animate-pulse mb-2" />
                    <div className="h-3 w-20 bg-white/8 rounded animate-pulse" />
                  </>
                ) : (
                  <>
                    <h1 className="text-xl font-bold text-white leading-none">
                      {user?.displayName ?? "My Profile"}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      @{user?.username ?? user?.id.slice(0, 8) ?? "…"}
                    </p>
                    {user?.location && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin size={12} className="text-white/40 shrink-0" />
                        <span className="text-xs text-white/40">{user.location}</span>
                      </div>
                    )}
                    {user?.createdAt && (
                      <p className="text-[11px] text-white/28 mt-0.5">
                        {t("member_since")} {new Date(user.createdAt).getFullYear()}
                      </p>
                    )}
                    {user?.isAdmin && (
                      <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-violet-500/20 border border-violet-500/30 w-fit">
                        <ShieldCheck size={13} className="text-violet-400" />
                        <span className="text-[11px] font-bold text-violet-300">أنت أدمن</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Edit profile button */}
            <motion.button
              whileTap={{ scale: 0.90 }}
              onClick={() => setLocation("/profile/edit")}
              aria-label={t("edit_profile")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/8 border border-white/12 text-xs font-semibold text-white/60 hover:text-white hover:bg-white/12 transition shrink-0"
            >
              <Pencil size={13} />
              {t("edit_profile")}
            </motion.button>
          </div>

          {/* ── Profile completeness card (non-blocking, frontend-computed) ── */}
          <AnimatePresence>
            {!isLoading && user && completePct < 100 && (
              <motion.button
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                onClick={() => setLocation("/profile/edit")}
                className="relative z-10 w-full flex flex-col gap-2.5 px-4 py-3.5 mb-4 rounded-2xl bg-amber-500/8 border border-amber-500/18 text-left"
              >
                {/* Header: percentage + chevron */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-amber-300">
                    {t("profile_complete_pct").replace("{pct}", String(completePct))}
                  </span>
                  <ChevronRight size={14} className="text-amber-400/60 shrink-0" />
                </div>

                {/* Progress bar */}
                <div className="h-1 w-full rounded-full bg-white/8 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${completePct}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="h-full rounded-full bg-amber-400"
                  />
                </div>

                {/* Missing field pills — up to 3 shown */}
                {missingFields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {missingFields.slice(0, 3).map(f => (
                      <span
                        key={f.key}
                        className="text-[10px] font-semibold text-amber-400/70 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/15"
                      >
                        + {f.label}
                      </span>
                    ))}
                    {missingFields.length > 3 && (
                      <span className="text-[10px] font-semibold text-amber-400/50">
                        +{missingFields.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </motion.button>
            )}
          </AnimatePresence>

          {/* Stats row — Listings | Followers | Following */}
          <div className="grid grid-cols-3 gap-3 relative z-10">
            <div className="bg-white/5 border border-white/8 rounded-2xl py-3.5 text-center">
              {isLoading ? (
                <div className="h-7 w-10 bg-white/10 rounded animate-pulse mx-auto mb-1" />
              ) : (
                <p className="text-2xl font-bold text-white leading-none tracking-tight">
                  {user?.auctionCount ?? myListings.length}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1.5 font-medium">{t("listings")}</p>
            </div>

            <button
              className="bg-white/5 border border-white/8 rounded-2xl py-3.5 text-center active:bg-white/8 transition-colors"
              onClick={() => user && setFollowModal("followers")}
              disabled={isLoading || !user}
            >
              {isLoading ? (
                <div className="h-7 w-10 bg-white/10 rounded animate-pulse mx-auto mb-1" />
              ) : (
                <p className="text-2xl font-bold text-white leading-none tracking-tight">{user?.followersCount ?? 0}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1.5 font-medium">{t("followers")}</p>
            </button>

            <button
              className="bg-white/5 border border-white/8 rounded-2xl py-3.5 text-center active:bg-white/8 transition-colors"
              onClick={() => user && setFollowModal("following")}
              disabled={isLoading || !user}
            >
              {isLoading ? (
                <div className="h-7 w-10 bg-white/10 rounded animate-pulse mx-auto mb-1" />
              ) : (
                <p className="text-2xl font-bold text-white leading-none tracking-tight">{user?.followingCount ?? 0}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1.5 font-medium">{t("following")}</p>
            </button>
          </div>
        </div>

        {/* ── Trust scores — seller + buyer (tap to open My Deals) ── */}
        {trust && (
          <div className="px-5 mt-3 mb-3">
            <button
              onClick={() => setLocation("/deals")}
              className="w-full grid grid-cols-2 gap-3 active:opacity-80 transition-opacity"
            >
              <TrustStatCard
                title={t("trust_seller")}
                score={trust.final_seller_score}
                color={trust.final_seller_color}
                completed={trust.completed_sales}
                total={trust.total_sell_deals}
                reviewsCount={trust.seller_reviews_count}
              />
              <TrustStatCard
                title={t("trust_buyer")}
                score={trust.final_buyer_score}
                color={trust.final_buyer_color}
                completed={trust.completed_buys}
                total={trust.total_buy_deals}
                reviewsCount={trust.buyer_reviews_count}
              />
            </button>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="px-5 mb-1">
          <div className="flex bg-white/5 border border-white/8 rounded-2xl p-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  {isActive && <motion.div layoutId="profile-tab-bg" className="absolute inset-0 bg-white/10 rounded-xl" />}
                  <Icon size={15} className={isActive ? "text-primary relative z-10" : "text-white/35 relative z-10"} />
                  <span className={isActive ? "text-white relative z-10" : "text-white/35 relative z-10"}>{t(tab.labelKey)}</span>
                  {tab.count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full relative z-10 ${isActive ? "bg-primary/25 text-primary" : "bg-white/8 text-white/40"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab content ── */}
        <div className="px-5 pt-3 pb-6">
          {activeTab === "my_auctions" && (
            auctionsLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
                    <div className="aspect-[3/4] bg-white/10 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : myListings.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {myListings.map(auction => {
                  const timeInfo = getTimeRemaining(auction.endsAt);
                  return (
                    <motion.div key={auction.id} whileTap={{ scale: 0.97 }}
                      onClick={() => setLocation(`/auction/${auction.id}`)}
                      className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden cursor-pointer">
                      <div className="aspect-[3/4] relative bg-black overflow-hidden">
                        <img
                          src={auction.thumbnailUrl ?? auction.mediaUrl ?? undefined}
                          alt={auction.title}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <p className="text-xs font-bold text-white line-clamp-1">{auction.title}</p>
                          <p className="text-sm font-bold text-white mt-0.5">{formatAuctionPrice(auction.currentBid, auction.currencyCode ?? "USD")}</p>
                          <p className={`text-[10px] font-bold mt-1 ${timeInfo.isUrgent ? "text-red-400" : "text-emerald-400"}`}>{timeInfo.text}</p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="py-16 flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mb-1">
                  <Grid size={26} className="text-white/20" />
                </div>
                <p className="text-sm font-semibold text-white/60">{t("no_auctions_yet")}</p>
                <p className="text-xs text-muted-foreground max-w-[220px]">{t("no_auctions_yet_sub")}</p>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setLocation("/create")}
                  className="mt-1 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                >
                  {t("create_first")}
                </motion.button>
              </div>
            )
          )}

          {activeTab === "my_bids" && (
            biddedLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin text-white/40" />
              </div>
            ) : biddedError ? (
              <div className="py-16 flex flex-col items-center text-center gap-3">
                <AlertCircle size={26} className="text-red-400/70" />
                <p className="text-sm text-red-300">{biddedError}</p>
              </div>
            ) : biddedAuctions.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {biddedAuctions.map(b => {
                  const timeInfo = getTimeRemaining(b.ends_at);
                  const ended = b.status === "ended" || b.status === "settled" || timeInfo.text === "Ended";
                  const leading = b.is_highest_bidder;
                  const isRemoved = b.status === "removed";
                  return (
                    <motion.button
                      key={b.id}
                      whileTap={isRemoved ? {} : { scale: 0.98 }}
                      onClick={isRemoved ? undefined : () => setLocation(`/auction/${b.id}`)}
                      className={`flex items-stretch gap-3 p-2 pr-3.5 rounded-2xl bg-white/5 border ${
                        isRemoved ? "border-white/10 opacity-60 cursor-default" : leading ? "border-emerald-500/30 active:bg-white/8" : "border-red-500/25 active:bg-white/8"
                      } text-left transition-colors`}
                    >
                      {/* Thumbnail — prefer poster image; never put an .mp4 URL inside <img> */}
                      <div className="relative w-20 h-24 rounded-xl overflow-hidden shrink-0 bg-white/5">
                        {(b.thumbnail_url ?? b.media_url) ? (
                          <img
                            src={b.thumbnail_url ?? b.media_url ?? undefined}
                            alt={b.title}
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><Gavel size={20} className="text-white/20" /></div>
                        )}
                        {/* Rank badge */}
                        {!isRemoved && (
                          <div className={`absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-bold ${
                            b.rank === 1 ? "bg-emerald-500/90 text-white" : "bg-black/60 text-white"
                          }`}>
                            {b.rank === 1 && <Trophy size={9} />}#{b.rank}
                          </div>
                        )}
                        {/* Deleted overlay */}
                        {isRemoved && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Trash2 size={18} className="text-white/50" />
                          </div>
                        )}
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                        <div>
                          <p className="text-sm font-bold text-white line-clamp-1">{b.title}</p>
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">{t("current")}</span>
                            <span className="text-sm font-bold text-white">
                              {formatAuctionPrice(b.current_price, b.currency_code ?? "USD")}
                            </span>
                          </div>
                          <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">{t("your_bid")}</span>
                            <span className="text-sm font-bold text-white/80">
                              {formatAuctionPrice(b.user_bid, b.currency_code ?? "USD")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          {isRemoved ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/50 border border-white/15">
                              {lang === "ar" ? "تم حذف المزاد" : "Auction deleted"}
                            </span>
                          ) : (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              leading
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-red-500/15 text-red-300 border border-red-500/25"
                            }`}>
                              {leading ? t("leading") : t("outbid")}
                            </span>
                          )}
                          {!isRemoved && (
                            <span className={`text-[10px] font-semibold ${ended ? "text-white/40" : (timeInfo.isUrgent ? "text-red-400" : "text-white/60")}`}>
                              {ended ? t("ended") : timeInfo.text}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            ) : (
              <div className="py-16 flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mb-1">
                  <Gavel size={26} className="text-white/20" />
                </div>
                <p className="text-sm font-semibold text-white/60">{t("no_bids_yet_title")}</p>
                <p className="text-xs text-muted-foreground max-w-[220px]">{t("no_bids_yet_sub")}</p>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setLocation("/feed")}
                  className="mt-1 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                >
                  {t("explore_auctions")}
                </motion.button>
              </div>
            )
          )}

          {activeTab === "saved" && (
            savedLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
                    <div className="aspect-[3/4] bg-white/10 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : savedAuctions.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {savedAuctions.map(auction => {
                  const timeInfo = getTimeRemaining(auction.endsAt);
                  return (
                    <motion.div key={auction.id} whileTap={{ scale: 0.97 }}
                      onClick={() => setLocation(`/auction/${auction.id}`)}
                      className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden cursor-pointer">
                      <div className="aspect-[3/4] relative bg-black overflow-hidden">
                        <img
                          src={auction.thumbnailUrl ?? auction.mediaUrl ?? undefined}
                          alt={auction.title}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <p className="text-xs font-bold text-white line-clamp-1">{auction.title}</p>
                          <p className="text-sm font-bold text-white mt-0.5">{formatAuctionPrice(auction.currentBid, auction.currencyCode ?? "USD")}</p>
                          <p className={`text-[10px] font-bold mt-1 ${timeInfo.isUrgent ? "text-red-400" : "text-emerald-400"}`}>{timeInfo.text}</p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="py-16 flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mb-1">
                  <Bookmark size={26} className="text-white/20" />
                </div>
                <p className="text-sm font-semibold text-white/60">{t("no_saved_yet")}</p>
                <p className="text-xs text-muted-foreground max-w-[220px]">{t("no_saved_yet_sub")}</p>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setLocation("/feed")}
                  className="mt-1 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                >
                  {t("explore_auctions")}
                </motion.button>
              </div>
            )
          )}
        </div>

        {/* ── Account section ── */}
        <div className="px-5 pt-2 pb-3">
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-2 px-1">{t("account_section")}</p>
          <div className="rounded-2xl bg-white/4 border border-white/8 divide-y divide-white/6 overflow-hidden">

            {/* Settings */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-white/5 active:bg-white/8 transition-colors"
            >
              <div className="w-8 h-8 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
                <Settings size={15} className="text-white/50" />
              </div>
              <span className="text-sm text-white/70 font-medium flex-1">{t("settings")}</span>
              <ChevronRight size={14} className="text-white/25" />
            </motion.button>

            {/* Privacy Policy */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setLocation("/privacy")}
              className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-white/5 active:bg-white/8 transition-colors"
            >
              <div className="w-8 h-8 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
                <Shield size={15} className="text-white/50" />
              </div>
              <span className="text-sm text-white/70 font-medium flex-1">{t("privacy_policy")}</span>
              <ChevronRight size={14} className="text-white/25" />
            </motion.button>

            {/* Log out */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-white/5 active:bg-white/8 transition-colors"
            >
              <div className="w-8 h-8 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
                <LogOut size={15} className="text-white/50" />
              </div>
              <span className="text-sm text-white/70 font-medium">{t("log_out")}</span>
            </motion.button>

          </div>
        </div>

        {/* ── Danger zone ── */}
        <div className="px-5 pb-10">
          <button
            onClick={() => { setDeleteError(null); setShowDeleteConfirm(true); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-500/15 text-xs font-semibold text-red-500/40 hover:text-red-400 hover:border-red-500/25 transition-colors"
          >
            <Trash2 size={13} />
            {t("delete_account")}
          </button>
        </div>

      </div>

      {/* Follow list modals */}
      {followModal && user && (
        <FollowListModal
          userId={user.id}
          mode={followModal}
          onClose={() => setFollowModal(null)}
        />
      )}

      {/* Settings drawer — controlled from the Account section */}
      <HamburgerMenu open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Delete Account confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) setShowDeleteConfirm(false); }}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="w-full max-w-sm bg-[#0e0e14] border border-red-500/20 rounded-3xl p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-500/15 flex items-center justify-center shrink-0">
                  <Trash2 size={18} className="text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">{t("delete_account")}</h3>
                  <p className="text-xs text-white/40">{t("delete_irreversible")}</p>
                </div>
              </div>

              <p className="text-sm text-white/60 leading-relaxed">
                {t("delete_account_body")}{" "}
                <span className="text-red-400 font-semibold">{t("delete_account_irreversible_emphasis")}</span>
              </p>

              {deleteError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                  {deleteError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 py-3 rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-white/60 hover:text-white transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                  className="flex-1 py-3 rounded-2xl bg-red-500/20 border border-red-500/30 text-sm font-bold text-red-400 hover:bg-red-500/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Trash2 size={14} />
                      Delete Forever
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MobileLayout>
  );
}
