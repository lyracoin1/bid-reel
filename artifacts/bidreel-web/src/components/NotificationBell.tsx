/**
 * NotificationBell
 *
 * A bell button with a glowing red unread-count badge. Clicking it opens a
 * bottom sheet panel showing the full notification list.
 *
 * Designed for mobile-first use inside the Profile header alongside
 * the HamburgerMenu.
 */

import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, X, ShoppingBag, Gavel, Trophy, Tag, UserPlus,
  Heart, Bookmark, MessageCircle, AtSign, ShieldAlert, Megaphone, XCircle,
} from "lucide-react";
import { useNotifications, type AppNotification, type NotificationType } from "@/hooks/use-notifications";

// ─── Icon + colour per notification type ──────────────────────────────────────

const TYPE_CONFIG: Record<
  NotificationType,
  { icon: typeof Bell; colour: string; label: string }
> = {
  // ── Canonical (spec) types ──────────────────────────────────────────────────
  followed_you:              { icon: UserPlus,    colour: "text-blue-400",    label: "Follower" },
  liked_your_auction:        { icon: Heart,       colour: "text-pink-400",    label: "Like" },
  saved_your_auction:        { icon: Bookmark,    colour: "text-purple-400",  label: "Saved" },
  commented_on_your_auction: { icon: MessageCircle, colour: "text-cyan-400",  label: "Comment" },
  replied_to_your_comment:   { icon: MessageCircle, colour: "text-cyan-400",  label: "Reply" },
  mentioned_you:             { icon: AtSign,      colour: "text-indigo-400",  label: "Mention" },
  bid_received:              { icon: ShoppingBag, colour: "text-emerald-400", label: "New Bid" },
  outbid:                    { icon: Gavel,       colour: "text-red-400",     label: "Outbid" },
  auction_won:               { icon: Trophy,      colour: "text-amber-400",   label: "Won" },
  auction_ended:             { icon: Trophy,      colour: "text-amber-400",   label: "Sold" },
  auction_unsold:            { icon: XCircle,     colour: "text-white/50",    label: "Unsold" },
  auction_ending_soon:       { icon: Gavel,       colour: "text-orange-400",  label: "Ending Soon" },
  admin_message:             { icon: Megaphone,   colour: "text-yellow-300",  label: "Announcement" },
  account_warning:           { icon: ShieldAlert, colour: "text-red-500",     label: "Warning" },
  // ── Legacy aliases (still emitted by old rows) ──────────────────────────────
  new_follower:     { icon: UserPlus,    colour: "text-blue-400",    label: "Follower" },
  new_bid:          { icon: ShoppingBag, colour: "text-emerald-400", label: "New Bid" },
  new_bid_received: { icon: ShoppingBag, colour: "text-emerald-400", label: "New Bid" },
  auction_started:  { icon: Tag,         colour: "text-primary",     label: "Live" },
  auction_removed:  { icon: Tag,         colour: "text-white/40",    label: "Removed" },
};

// ─── Deep-link target per notification type ──────────────────────────────────
// Returns the route to navigate to when the row is tapped, or null when there
// is no useful destination (e.g. admin_message with no metadata link).

function getDeepLink(n: AppNotification): string | null {
  switch (n.type) {
    case "followed_you":
    case "new_follower":
      return n.actorId ? `/profile/${n.actorId}` : null;

    case "liked_your_auction":
    case "saved_your_auction":
    case "bid_received":
    case "new_bid_received":
    case "new_bid":
    case "outbid":
    case "auction_won":
    case "auction_ended":
    case "auction_unsold":
    case "auction_ending_soon":
    case "auction_started":
    case "auction_removed":
      return n.auctionId ? `/auctions/${n.auctionId}` : null;

    case "commented_on_your_auction":
    case "replied_to_your_comment":
    case "mentioned_you": {
      const commentId = (n.metadata?.["commentId"] as string | undefined);
      if (n.auctionId && commentId) return `/auctions/${n.auctionId}?comment=${commentId}`;
      return n.auctionId ? `/auctions/${n.auctionId}` : null;
    }

    case "admin_message":
    case "account_warning": {
      // SECURITY: only honour internal in-app paths. Anything that doesn't
      // start with a single "/" (or that uses "//", which would be a
      // protocol-relative URL) is dropped to prevent a malicious or
      // compromised admin from broadcasting a phishing link.
      const link = n.metadata?.["link"];
      if (typeof link !== "string") return null;
      if (!link.startsWith("/") || link.startsWith("//")) return null;
      return link;
    }
  }
}

// ─── Time formatter ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Single notification row ──────────────────────────────────────────────────

function NotificationRow({ n, onNavigate }: { n: AppNotification; onNavigate: (path: string) => void }) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.outbid;
  const Icon = cfg.icon;
  const target = getDeepLink(n);

  const handleClick = () => {
    if (target) onNavigate(target);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={handleClick}
      role={target ? "button" : undefined}
      tabIndex={target ? 0 : undefined}
      onKeyDown={(e) => {
        if (target && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onNavigate(target);
        }
      }}
      className={[
        "flex items-start gap-3 px-5 py-4 border-b border-white/6 transition-colors",
        n.read ? "opacity-50" : "bg-white/3",
        target ? "cursor-pointer active:bg-white/8" : "",
      ].join(" ")}
    >
      {/* Type icon */}
      <div
        className={[
          "mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
          "bg-white/6 border border-white/10",
        ].join(" ")}
      >
        <Icon size={16} className={cfg.colour} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={`text-xs font-semibold uppercase tracking-wide ${cfg.colour}`}>
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {timeAgo(n.createdAt)}
          </span>
        </div>
        <p className="text-sm text-white/90 leading-snug line-clamp-2">{n.message}</p>
      </div>

      {/* Unread dot */}
      {!n.read && (
        <div className="mt-2 w-2 h-2 rounded-full bg-red-500 flex-shrink-0 shadow-[0_0_6px_2px_rgba(239,68,68,0.6)]" />
      )}
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [, setLocation] = useLocation();

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const visibleNotifications = notifications
    .filter(n => Date.now() - new Date(n.createdAt).getTime() <= THIRTY_DAYS_MS)
    .slice(0, 50);

  const handleOpen = useCallback(() => {
    setOpen(true);
    // Mark all read when panel opens
    if (unreadCount > 0) markAllRead();
  }, [unreadCount, markAllRead]);

  const handleClose = useCallback(() => setOpen(false), []);

  const handleNavigate = useCallback((path: string) => {
    // getDeepLink() already filtered out any non-internal URLs, but defend in
    // depth: only ever navigate to single-leading-slash, non-protocol-relative
    // in-app routes.
    if (!path.startsWith("/") || path.startsWith("//")) return;
    setOpen(false);
    setLocation(path);
  }, [setLocation]);

  return (
    <>
      {/* ── Bell trigger button ─────────────────────────────────────────────── */}
      <motion.button
        whileTap={{ scale: 0.88 }}
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ""}`}
        className={[
          "relative w-10 h-10 rounded-full bg-black/50 backdrop-blur-md",
          "border border-white/12 flex items-center justify-center text-white",
        ].join(" ")}
      >
        <Bell size={18} />

        {/* Red neon badge */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className={[
                "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1",
                "rounded-full bg-red-500 border border-background",
                "flex items-center justify-center",
                "text-[10px] font-bold text-white leading-none",
                "shadow-[0_0_8px_2px_rgba(239,68,68,0.7)]",
              ].join(" ")}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── Slide-up panel ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={handleClose}
            />

            {/* Panel */}
            <motion.div
              key="panel"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
              className={[
                "fixed bottom-0 left-0 right-0 z-50 max-h-[78vh]",
                "bg-[#0d0d0f] border-t border-white/10 rounded-t-3xl",
                "flex flex-col overflow-hidden",
              ].join(" ")}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <Bell size={18} className="text-white" />
                  <h2 className="text-base font-bold text-white">Notifications</h2>
                  {visibleNotifications.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({visibleNotifications.length})
                    </span>
                  )}
                </div>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={handleClose}
                  className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center text-white/60"
                >
                  <X size={14} />
                </motion.button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {visibleNotifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Bell size={32} className="opacity-30" />
                    <p className="text-sm">No notifications yet</p>
                  </div>
                ) : (
                  visibleNotifications.map(n => <NotificationRow key={n.id} n={n} onNavigate={handleNavigate} />)
                )}
              </div>

              {/* Bottom safe-area spacer */}
              <div className="h-[env(safe-area-inset-bottom,16px)]" />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
