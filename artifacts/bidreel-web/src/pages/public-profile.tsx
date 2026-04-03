/**
 * PublicProfilePage — view another user's public profile.
 *
 * Route: /users/:userId
 *
 * Shows:
 * - Avatar, display name, bio
 * - Followers / following counts (clickable → modals)
 * - Follow / Unfollow button (hidden when viewing own profile)
 * - Their active auction listings
 */

import { useState, useEffect } from "react";
import { ArrowLeft, Grid } from "lucide-react";
import { motion } from "framer-motion";
import { useLocation, useRoute } from "wouter";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFollow } from "@/hooks/use-follow";
import { useAuctions } from "@/hooks/use-auctions";
import { getUserPublicProfileApi, type ApiPublicProfile } from "@/lib/api-client";
import { formatAuctionPrice } from "@/lib/geo";
import { getTimeRemaining } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { FollowListModal } from "@/components/FollowListModal";
import { AnimatePresence } from "framer-motion";

type FollowModal = "followers" | "following" | null;

export default function PublicProfilePage() {
  const [, params] = useRoute("/users/:userId");
  const [, setLocation] = useLocation();
  const userId = params?.userId ?? "";
  const { t } = useLang();

  const { user: currentUser } = useCurrentUser();
  const { isFollowing, isPending, toggle } = useFollow();

  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [followModal, setFollowModal] = useState<FollowModal>(null);

  // Local follower count state — updated optimistically after follow/unfollow
  const [localFollowersCount, setLocalFollowersCount] = useState<number | null>(null);

  const { data: allAuctions, isLoading: auctionsLoading } = useAuctions();

  const isSelf = !!currentUser && currentUser.id === userId;
  const following = isFollowing(userId);
  const pending = isPending(userId);

  // Seller listings
  const userListings = allAuctions.filter(a => a.seller.id === userId);

  useEffect(() => {
    if (!userId) return;
    setProfileLoading(true);
    setProfileError(null);
    getUserPublicProfileApi(userId)
      .then(p => {
        setProfile(p);
        setLocalFollowersCount(p.followersCount);
      })
      .catch(err => {
        setProfileError(err.message ?? "User not found");
      })
      .finally(() => setProfileLoading(false));
  }, [userId]);

  const handleFollowToggle = async () => {
    if (!userId || pending) return;
    const wasFollowing = following;
    // Optimistically update follower count
    setLocalFollowersCount(c => (c ?? 0) + (wasFollowing ? -1 : 1));
    await toggle(userId);
  };

  const followersCount = localFollowersCount ?? profile?.followersCount ?? 0;

  return (
    <MobileLayout hideNav={false}>
      <div className="min-h-full bg-background">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-4 pt-14 pb-4">
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/feed")}
            className="w-10 h-10 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center active:scale-90 transition-transform shrink-0"
          >
            <ArrowLeft size={18} className="text-white" />
          </button>
          <h1 className="text-base font-bold text-white truncate">
            {profileLoading ? "Loading…" : (profile?.displayName ?? `@${userId.slice(0, 8)}`)}
          </h1>
        </div>

        {profileError ? (
          <div className="py-20 text-center px-6">
            <p className="text-red-400 text-sm">{profileError}</p>
            <button onClick={() => setLocation("/feed")} className="mt-4 text-sm text-primary underline">
              Go back
            </button>
          </div>
        ) : (
          <>
            {/* ── Hero ── */}
            <div className="px-5 pb-5">
              <div className="flex items-center gap-4 mb-5">
                {/* Avatar */}
                {profileLoading ? (
                  <div className="w-20 h-20 rounded-2xl bg-white/10 animate-pulse shrink-0" />
                ) : (
                  <UserAvatar
                    src={profile?.avatarUrl ?? null}
                    name={profile?.displayName ?? userId.slice(0, 8)}
                    size={80}
                    className="rounded-2xl ring-2 ring-white/10 shrink-0"
                  />
                )}

                {/* Name + bio */}
                <div className="flex-1 min-w-0">
                  {profileLoading ? (
                    <>
                      <div className="h-5 w-28 bg-white/10 rounded animate-pulse mb-2" />
                      <div className="h-3 w-20 bg-white/8 rounded animate-pulse" />
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg font-bold text-white leading-tight truncate">
                        {profile?.displayName ?? "Unknown"}
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">@{userId.slice(0, 8)}</p>
                      {profile?.bio && (
                        <p className="text-xs text-white/60 mt-1.5 line-clamp-2">{profile.bio}</p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className={`grid gap-3 mb-4 ${isSelf ? "grid-cols-2" : "grid-cols-3"}`}>
                {/* Listings */}
                <div className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center">
                  {profileLoading ? (
                    <div className="h-6 w-8 bg-white/10 rounded animate-pulse mx-auto mb-1" />
                  ) : (
                    <p className="text-xl font-bold text-white leading-none">{profile?.auctionCount ?? 0}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t("listings")}</p>
                </div>

                {/* Followers */}
                <button
                  className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center active:bg-white/8 transition-colors"
                  onClick={() => profile && setFollowModal("followers")}
                  disabled={profileLoading || !profile}
                >
                  {profileLoading ? (
                    <div className="h-6 w-8 bg-white/10 rounded animate-pulse mx-auto mb-1" />
                  ) : (
                    <p className="text-xl font-bold text-white leading-none">{followersCount}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t("followers")}</p>
                </button>

                {/* Following */}
                <button
                  className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center active:bg-white/8 transition-colors"
                  onClick={() => profile && setFollowModal("following")}
                  disabled={profileLoading || !profile}
                >
                  {profileLoading ? (
                    <div className="h-6 w-8 bg-white/10 rounded animate-pulse mx-auto mb-1" />
                  ) : (
                    <p className="text-xl font-bold text-white leading-none">{profile?.followingCount ?? 0}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t("following")}</p>
                </button>
              </div>

              {/* Follow / Unfollow button — hidden on own profile */}
              {!isSelf && !profileLoading && (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={pending}
                  onClick={handleFollowToggle}
                  className={[
                    "w-full py-3 rounded-2xl text-sm font-bold border transition-all duration-200",
                    pending ? "opacity-60 cursor-wait" : "",
                    following
                      ? "bg-[#0ea5e9]/15 border-[#0ea5e9]/40 text-[#7dd3fc]"
                      : "bg-primary border-primary/50 text-white",
                  ].join(" ")}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={following ? "following" : "follow"}
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.15 }} className="block"
                    >
                      {following ? `✓ ${t("following")}` : `+ ${t("follow")}`}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              )}
            </div>

            {/* ── Listings grid ── */}
            <div className="px-5 pb-8">
              <div className="flex items-center gap-2 mb-3">
                <Grid size={14} className="text-white/40" />
                <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">{t("listings")}</span>
              </div>

              {auctionsLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
                      <div className="aspect-[3/4] bg-white/10 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : userListings.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {userListings.map(auction => {
                    const timeInfo = getTimeRemaining(auction.endsAt);
                    return (
                      <motion.div key={auction.id} whileTap={{ scale: 0.97 }}
                        onClick={() => setLocation(`/auction/${auction.id}`)}
                        className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden cursor-pointer">
                        <div className="aspect-[3/4] relative">
                          <img src={auction.mediaUrl} className="w-full h-full object-cover" alt={auction.title} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <p className="text-xs font-bold text-white line-clamp-1">{auction.title}</p>
                            <p className="text-sm font-bold text-white mt-0.5">
                              {formatAuctionPrice(auction.currentBid, auction.currencyCode ?? "USD")}
                            </p>
                            <p className={`text-[10px] font-bold mt-1 ${timeInfo.isUrgent ? "text-red-400" : "text-emerald-400"}`}>
                              {timeInfo.text}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <Grid size={28} className="text-white/15 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t("no_listings")}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Follow list modals */}
      {followModal && (profile || isSelf) && (
        <FollowListModal
          userId={userId}
          mode={followModal}
          onClose={() => setFollowModal(null)}
        />
      )}
    </MobileLayout>
  );
}
