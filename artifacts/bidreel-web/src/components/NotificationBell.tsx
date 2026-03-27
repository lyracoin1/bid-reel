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
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, ShoppingBag, Gavel, Trophy, Tag } from "lucide-react";
import { useNotifications, type AppNotification, type NotificationType } from "@/hooks/use-notifications";

// ─── Icon + colour per notification type ──────────────────────────────────────

const TYPE_CONFIG: Record<
  NotificationType,
  { icon: typeof Bell; colour: string; label: string }
> = {
  outbid: {
    icon: Gavel,
    colour: "text-red-400",
    label: "Outbid",
  },
  auction_started: {
    icon: Tag,
    colour: "text-primary",
    label: "Live",
  },
  auction_won: {
    icon: Trophy,
    colour: "text-amber-400",
    label: "Won",
  },
  new_bid: {
    icon: ShoppingBag,
    colour: "text-emerald-400",
    label: "New Bid",
  },
};

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

function NotificationRow({ n }: { n: AppNotification }) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.outbid;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        "flex items-start gap-3 px-5 py-4 border-b border-white/6 transition-colors",
        n.read ? "opacity-50" : "bg-white/3",
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

  const handleOpen = useCallback(() => {
    setOpen(true);
    // Mark all read when panel opens
    if (unreadCount > 0) markAllRead();
  }, [unreadCount, markAllRead]);

  const handleClose = useCallback(() => setOpen(false), []);

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
                  {notifications.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({notifications.length})
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
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Bell size={32} className="opacity-30" />
                    <p className="text-sm">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map(n => <NotificationRow key={n.id} n={n} />)
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
