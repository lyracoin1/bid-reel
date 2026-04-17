/**
 * FollowListModal — slide-up sheet showing a user's followers or following list.
 *
 * Each row shows avatar + display name + Follow/Unfollow button (hidden for self).
 * Supports loading, empty, and error states.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { X, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useFollow } from "@/hooks/use-follow";
import { useOverlayBack } from "@/hooks/use-overlay-back";
import { useLang } from "@/contexts/LanguageContext";
import { getFollowersApi, getFollowingApi, type ApiFollowUser } from "@/lib/api-client";

type Mode = "followers" | "following";

interface FollowListModalProps {
  userId: string;
  mode: Mode;
  onClose: () => void;
}

export function FollowListModal({ userId, mode, onClose }: FollowListModalProps) {
  const [users, setUsers] = useState<ApiFollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isFollowing, isPending, toggle } = useFollow();
  const [, setLocation] = useLocation();
  const { t } = useLang();

  // Android hardware back closes this sheet first (before navigating).
  // The sheet is open for its entire mounted lifetime, hence isOpen={true}.
  useOverlayBack(true, onClose);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const fetch = mode === "followers" ? getFollowersApi : getFollowingApi;
    fetch(userId)
      .then(setUsers)
      .catch(() => setError("Failed to load list"))
      .finally(() => setLoading(false));
  }, [userId, mode]);

  const title = mode === "followers" ? t("followers") : t("following");

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex flex-col justify-end">
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Sheet */}
        <motion.div
          className="relative z-10 bg-[#0f0f14] rounded-t-3xl border-t border-white/10 flex flex-col"
          style={{ maxHeight: "80dvh" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          {/* Handle + header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/8">
            <div className="w-8 h-1 rounded-full bg-white/20 absolute top-2.5 left-1/2 -translate-x-1/2" />
            <h2 className="text-base font-bold text-white mt-3">{title}</h2>
            <button
              onClick={onClose}
              className="mt-3 w-8 h-8 rounded-full bg-white/8 flex items-center justify-center active:scale-90 transition-transform"
            >
              <X size={16} className="text-white/70" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="space-y-0">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-white/5">
                    <div className="w-11 h-11 rounded-full bg-white/10 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-32 bg-white/10 rounded animate-pulse" />
                      <div className="h-3 w-20 bg-white/6 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="py-16 text-center">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            ) : users.length === 0 ? (
              <div className="py-16 text-center flex flex-col items-center gap-3">
                <Users size={32} className="text-white/20" />
                <p className="text-sm text-muted-foreground">
                  {mode === "followers" ? "No followers yet" : "Not following anyone yet"}
                </p>
              </div>
            ) : (
              <div>
                {users.map(u => {
                  const following = isFollowing(u.id);
                  const pending = isPending(u.id);

                  return (
                    <div key={u.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-white/5 active:bg-white/3 transition-colors">
                      {/* Avatar → navigate to profile */}
                      <button
                        onClick={() => { onClose(); setLocation(`/users/${u.id}`); }}
                        className="shrink-0"
                      >
                        <UserAvatar
                          src={u.avatarUrl}
                          name={u.displayName ?? u.id.slice(0, 8)}
                          size={44}
                          className="rounded-full ring-1 ring-white/10"
                        />
                      </button>

                      {/* Name */}
                      <button
                        className="flex-1 text-left min-w-0"
                        onClick={() => { onClose(); setLocation(`/users/${u.id}`); }}
                      >
                        <p className="text-sm font-semibold text-white leading-none truncate">
                          {u.displayName ?? u.username ?? `@${u.id.slice(0, 8)}`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          @{u.username ?? u.id.slice(0, 8)}
                        </p>
                      </button>

                      {/* Follow button (hidden for self) */}
                      {!u.isSelf && (
                        <button
                          disabled={pending}
                          onClick={() => toggle(u.id)}
                          className={[
                            "shrink-0 px-4 py-1.5 rounded-full text-xs font-bold border transition-all duration-200",
                            pending ? "opacity-50 cursor-wait" : "active:scale-95",
                            following
                              ? "bg-[#0ea5e9]/15 border-[#0ea5e9]/40 text-[#7dd3fc]"
                              : "bg-white/10 border-white/20 text-white",
                          ].join(" ")}
                        >
                          {following ? `✓ ${t("following")}` : `+ ${t("follow")}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Safe area bottom padding */}
            <div className="h-8" />
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
