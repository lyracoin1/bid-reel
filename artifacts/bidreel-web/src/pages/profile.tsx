import { useState, useEffect } from "react";
import { Grid, Gavel, LogOut, ShieldCheck, Trash2, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { formatAuctionPrice } from "@/lib/geo";
import { HamburgerMenu } from "@/components/HamburgerMenu";
import { useCurrentUser, clearCurrentUserCache } from "@/hooks/use-current-user";
import { useAuctions } from "@/hooks/use-auctions";
import { getUserBidsApi, clearToken, deleteAccountApi, type ApiMyBidEntry } from "@/lib/api-client";
import { clearAdminSession } from "@/pages/admin/admin-session";
import { deleteNativeFcmToken } from "@/lib/native-fcm";
import { getTimeRemaining } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { UserAvatar } from "@/components/ui/user-avatar";
import { FollowListModal } from "@/components/FollowListModal";

type Tab = "listings" | "bids";
type FollowModal = "followers" | "following" | null;

export default function Profile() {
  const [activeTab, setActiveTab] = useState<Tab>("listings");
  const [myBids, setMyBids] = useState<ApiMyBidEntry[]>([]);
  const [bidsLoading, setBidsLoading] = useState(true);
  const [followModal, setFollowModal] = useState<FollowModal>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { t } = useLang();

  const { user, isLoading: userLoading } = useCurrentUser();

  async function handleDeleteAccount() {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountApi();
      await deleteNativeFcmToken();
      clearCurrentUserCache();
      clearAdminSession();
      clearToken();
      setLocation("/login");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account. Please try again.");
      setIsDeleting(false);
    }
  }
  const { data: allAuctions, isLoading: auctionsLoading } = useAuctions();

  const myListings = user
    ? allAuctions.filter(a => a.seller.id === user.id)
    : [];

  useEffect(() => {
    setBidsLoading(true);
    getUserBidsApi()
      .then(setMyBids)
      .catch(err => console.error("[profile] Failed to load bids:", err))
      .finally(() => setBidsLoading(false));
  }, []);

  const tabs: { id: Tab; labelKey: "listings" | "my_bids"; icon: typeof Grid; count: number }[] = [
    { id: "listings", labelKey: "listings", icon: Grid,  count: myListings.length },
    { id: "bids",     labelKey: "my_bids",  icon: Gavel, count: myBids.length },
  ];

  const isLoading = userLoading || auctionsLoading;

  return (
    <MobileLayout>
      <div className="min-h-full bg-background">

        {/* ── Hero header ── */}
        <div className="relative px-5 pt-14 pb-6 overflow-hidden">
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

            {/* Action buttons row */}
            <div className="flex items-center gap-2">
              <HamburgerMenu />
            </div>
          </div>

          {/* Stats row — Listings | Followers | Following */}
          <div className="grid grid-cols-3 gap-3 relative z-10">
            {/* Listings */}
            <div className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center">
              {isLoading ? (
                <div className="h-6 w-8 bg-white/10 rounded animate-pulse mx-auto mb-1" />
              ) : (
                <p className="text-xl font-bold text-white leading-none">
                  {user?.auctionCount ?? myListings.length}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t("listings")}</p>
            </div>

            {/* Followers — clickable */}
            <button
              className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center active:bg-white/8 transition-colors"
              onClick={() => user && setFollowModal("followers")}
              disabled={isLoading || !user}
            >
              {isLoading ? (
                <div className="h-6 w-8 bg-white/10 rounded animate-pulse mx-auto mb-1" />
              ) : (
                <p className="text-xl font-bold text-white leading-none">{user?.followersCount ?? 0}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t("followers")}</p>
            </button>

            {/* Following — clickable */}
            <button
              className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center active:bg-white/8 transition-colors"
              onClick={() => user && setFollowModal("following")}
              disabled={isLoading || !user}
            >
              {isLoading ? (
                <div className="h-6 w-8 bg-white/10 rounded animate-pulse mx-auto mb-1" />
              ) : (
                <p className="text-xl font-bold text-white leading-none">{user?.followingCount ?? 0}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t("following")}</p>
            </button>
          </div>
        </div>

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
          {activeTab === "listings" && (
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
                      <div className="aspect-[3/4] relative">
                        <img src={auction.mediaUrl} className="w-full h-full object-cover" alt={auction.title} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
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
              <div className="py-16 text-center">
                <p className="text-muted-foreground text-sm">{t("no_listings")}</p>
                <button onClick={() => setLocation("/create")} className="mt-4 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold">
                  {t("create_first")}
                </button>
              </div>
            )
          )}

          {activeTab === "bids" && (
            bidsLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/8">
                    <div className="w-16 h-20 rounded-xl bg-white/10 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-white/10 rounded animate-pulse" />
                      <div className="h-3 w-1/2 bg-white/8 rounded animate-pulse" />
                      <div className="h-3 w-1/3 bg-white/8 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : myBids.length > 0 ? (
              <div className="space-y-3">
                {myBids.map(entry => {
                  if (!entry.auction) return null;
                  const a = entry.auction;
                  const timeInfo = getTimeRemaining(a.endsAt);
                  return (
                    <motion.div key={entry.auctionId} whileTap={{ scale: 0.98 }}
                      onClick={() => setLocation(`/auction/${entry.auctionId}`)}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/8 cursor-pointer">
                      <div className="w-16 h-20 rounded-xl overflow-hidden shrink-0 bg-white/8">
                        {a.mediaUrl && (
                          <img src={a.mediaUrl} className="w-full h-full object-cover" alt={a.title} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white text-sm line-clamp-1">{a.title}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Current: <span className="text-white font-bold">{formatAuctionPrice(a.currentBid, a.currencyCode ?? "USD")}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Your bid: <span className="text-white">{formatAuctionPrice(entry.myBidAmount, a.currencyCode ?? "USD")}</span>
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${entry.isLeading ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                            {entry.isLeading ? t("leading") : t("outbid")}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{timeInfo.text}</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="py-16 text-center">
                <Gavel size={32} className="text-white/20 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No bids placed yet</p>
                <button onClick={() => setLocation("/feed")} className="mt-4 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold">
                  Browse auctions
                </button>
              </div>
            )
          )}
        </div>

        {/* Logout + settings footer */}
        <div className="px-5 pb-8 space-y-3">
          <button onClick={() => { void deleteNativeFcmToken(); clearCurrentUserCache(); clearAdminSession(); clearToken(); setLocation("/login"); }}
            className="w-full py-3.5 rounded-2xl border border-white/8 bg-white/3 flex items-center justify-center gap-2 text-sm font-semibold text-white/50 hover:text-white/80 hover:bg-white/6 transition">
            <LogOut size={16} />{t("log_out")}
          </button>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setLocation("/privacy")}
              className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/50 transition py-1"
            >
              <Shield size={11} />
              Privacy Policy
            </button>
            <button
              onClick={() => { setDeleteError(null); setShowDeleteConfirm(true); }}
              className="flex items-center gap-1.5 text-xs text-red-500/50 hover:text-red-400 transition py-1"
            >
              <Trash2 size={11} />
              Delete Account
            </button>
          </div>
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
                  <h3 className="font-bold text-white text-base">Delete Account</h3>
                  <p className="text-xs text-white/40">This cannot be undone</p>
                </div>
              </div>

              <p className="text-sm text-white/60 leading-relaxed">
                This will permanently delete your account, profile, bids, follows, and saved auctions.
                Your auction listings will be anonymised. <span className="text-red-400 font-semibold">This action is irreversible.</span>
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
