import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Home, Search, Plus, User, Bell, X, ShoppingBag, Gavel, Trophy, Tag, UserPlus,
  Heart, Bookmark, MessageCircle, AtSign, ShieldAlert, Megaphone, XCircle,
  Share2, FileText, Star, CreditCard, Truck, Package, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { useNotifications, type AppNotification, type NotificationType } from "@/hooks/use-notifications";
import { useOverlayBack } from "@/hooks/use-overlay-back";
import type { TKey, Language } from "@/lib/i18n";

// ─── Notification panel helpers (icon + colour + i18n label key per type) ──

const TYPE_CONFIG: Record<
  NotificationType,
  { icon: typeof Bell; colour: string; labelKey: TKey }
> = {
  // canonical
  followed_you:              { icon: UserPlus,    colour: "text-blue-400",    labelKey: "notif_label_followed_you" },
  liked_your_auction:        { icon: Heart,       colour: "text-pink-400",    labelKey: "notif_label_liked"        },
  saved_your_auction:        { icon: Bookmark,    colour: "text-purple-400",  labelKey: "notif_label_saved"        },
  commented_on_your_auction: { icon: MessageCircle, colour: "text-cyan-400",  labelKey: "notif_label_commented"    },
  replied_to_your_comment:   { icon: MessageCircle, colour: "text-cyan-400",  labelKey: "notif_label_replied"      },
  mentioned_you:             { icon: AtSign,      colour: "text-indigo-400",  labelKey: "notif_label_mentioned"    },
  bid_received:              { icon: ShoppingBag, colour: "text-emerald-400", labelKey: "notif_label_bid_received" },
  outbid:                    { icon: Gavel,       colour: "text-red-400",     labelKey: "notif_label_outbid"       },
  auction_won:               { icon: Trophy,      colour: "text-amber-400",   labelKey: "notif_label_won"          },
  auction_ended:             { icon: Trophy,      colour: "text-amber-400",   labelKey: "notif_label_ended"        },
  auction_unsold:            { icon: XCircle,     colour: "text-white/50",    labelKey: "notif_label_unsold"       },
  auction_ending_soon:       { icon: Gavel,       colour: "text-orange-400",  labelKey: "notif_label_ending_soon"  },
  admin_message:             { icon: Megaphone,   colour: "text-yellow-300",  labelKey: "notif_label_admin"        },
  account_warning:           { icon: ShieldAlert, colour: "text-red-500",     labelKey: "notif_label_warning"      },
  // auction shared
  auction_shared:                { icon: Share2,        colour: "text-sky-400",     labelKey: "notif_label_shared"         },
  // Secure Deals
  buyer_conditions_submitted:    { icon: FileText,      colour: "text-violet-400",  labelKey: "notif_label_conditions"     },
  seller_conditions_submitted:   { icon: FileText,      colour: "text-violet-400",  labelKey: "notif_label_conditions"     },
  deal_rated:                    { icon: Star,          colour: "text-amber-400",   labelKey: "notif_label_rated"          },
  payment_proof_uploaded:        { icon: CreditCard,    colour: "text-emerald-400", labelKey: "notif_label_payment"        },
  shipment_proof_uploaded:       { icon: Truck,         colour: "text-blue-400",    labelKey: "notif_label_shipped"        },
  buyer_delivery_proof_uploaded: { icon: Package,       colour: "text-purple-400",  labelKey: "notif_label_delivery_proof" },
  buyer_confirmed_receipt:       { icon: CheckCircle2,  colour: "text-green-400",   labelKey: "notif_label_confirmed"      },
  shipping_fee_dispute_created:  { icon: AlertTriangle, colour: "text-orange-400",  labelKey: "notif_label_dispute"        },
  seller_penalty_applied:        { icon: ShieldAlert,   colour: "text-red-500",     labelKey: "notif_label_penalty"        },
  // Escrow (Part #12)
  escrow_released:          { icon: CheckCircle2,  colour: "text-emerald-400", labelKey: "notif_label_escrow_released" },
  escrow_disputed:          { icon: AlertTriangle, colour: "text-orange-400",  labelKey: "notif_label_escrow_disputed" },
  escrow_released_with_fee: { icon: CheckCircle2,  colour: "text-emerald-400", labelKey: "notif_label_escrow_released_with_fee" },
  // External Payment Warning (Part #13)
  external_payment_warning: { icon: AlertTriangle, colour: "text-red-400", labelKey: "notif_label_ext_payment" },
  // legacy aliases
  new_follower:     { icon: UserPlus,    colour: "text-blue-400",    labelKey: "notif_label_followed_you" },
  new_bid:          { icon: ShoppingBag, colour: "text-emerald-400", labelKey: "notif_label_bid_received" },
  new_bid_received: { icon: ShoppingBag, colour: "text-emerald-400", labelKey: "notif_label_bid_received" },
  auction_started:  { icon: Tag,         colour: "text-primary",     labelKey: "notif_label_live"         },
  auction_removed:  { icon: Tag,         colour: "text-white/40",    labelKey: "notif_label_removed"      },
};

/**
 * Locale-aware "5m ago" / "just now" formatter using Intl.RelativeTimeFormat.
 * Falls back gracefully on environments without the API.
 */
function formatTimeAgo(iso: string, lang: Language): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
    if (mins < 1) return rtf.format(0, "minute");
    if (mins < 60) return rtf.format(-mins, "minute");
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return rtf.format(-hrs, "hour");
    return rtf.format(-Math.floor(hrs / 24), "day");
  } catch {
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }
}

function NotifRow({ n }: { n: AppNotification }) {
  const { t, lang } = useLang();
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.outbid;
  const Icon = cfg.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-start gap-3 px-5 py-4 border-b border-white/6",
        n.read ? "opacity-50" : "bg-white/3",
      )}
    >
      <div className="mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/6 border border-white/10">
        <Icon size={16} className={cfg.colour} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={`text-xs font-semibold uppercase tracking-wide ${cfg.colour}`}>
            {t(cfg.labelKey)}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0">{formatTimeAgo(n.createdAt, lang)}</span>
        </div>
        <p className="text-sm text-white/90 leading-snug line-clamp-2">{n.message}</p>
      </div>
      {!n.read && (
        <div className="mt-2 w-2 h-2 rounded-full bg-red-500 flex-shrink-0 shadow-[0_0_6px_2px_rgba(239,68,68,0.6)]" />
      )}
    </motion.div>
  );
}

// ─── Bell nav button + slide-up panel ─────────────────────────────────────────

function BellNavItem() {
  const [open, setOpen] = useState(false);
  const { t } = useLang();
  const { notifications, unreadCount, markAllRead } = useNotifications();

  const handleOpen = useCallback(() => {
    setOpen(true);
    if (unreadCount > 0) markAllRead();
  }, [unreadCount, markAllRead]);

  const handleClose = useCallback(() => setOpen(false), []);

  // Android hardware back closes the notifications panel first.
  useOverlayBack(open, handleClose);

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={handleOpen}
        aria-label={t("notifications_title")}
        className="relative flex flex-col items-center justify-center gap-0.5 cursor-pointer"
        style={{ minWidth: 48, minHeight: 48 }}
      >
        {/* Active pill when panel is open */}
        {open && (
          <div className="absolute inset-0 rounded-xl bg-primary/12" />
        )}

        <div className="relative z-10">
          <Bell
            size={22}
            strokeWidth={open ? 2.5 : 1.8}
            className={cn(
              "transition-colors duration-200",
              open ? "text-primary" : "text-white/35",
            )}
          />
          {/* Unread badge */}
          <AnimatePresence>
            {unreadCount > 0 && (
              <motion.span
                key="badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full bg-red-500 border border-background flex items-center justify-center text-[9px] font-bold text-white leading-none shadow-[0_0_6px_2px_rgba(239,68,68,0.5)]"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <span className={cn(
          "relative z-10 text-[10px] font-semibold tracking-wide transition-colors",
          open ? "text-primary" : "text-white/30",
        )}>
          {unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount})` : t("notifs_short")}
        </span>
      </motion.button>

      {/* Slide-up notification panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={handleClose}
            />
            <motion.div
              key="panel"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
              className="fixed bottom-0 left-0 right-0 z-50 max-h-[78vh] bg-[#0d0d0f] border-t border-white/10 rounded-t-3xl flex flex-col overflow-hidden"
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <Bell size={18} className="text-white" />
                  <h2 className="text-base font-bold text-white">{t("notifications_title")}</h2>
                  {notifications.length > 0 && (
                    <span className="text-xs text-muted-foreground">({notifications.length})</span>
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
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Bell size={32} className="opacity-30" />
                    <p className="text-sm">{t("notifications_empty")}</p>
                  </div>
                ) : (
                  notifications.map(n => <NotifRow key={n.id} n={n} />)
                )}
              </div>
              <div className="h-[env(safe-area-inset-bottom,16px)]" />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Bottom navigation bar ────────────────────────────────────────────────────

export function BottomNav() {
  const [location] = useLocation();
  const { t } = useLang();

  // Visual order left→right: Home · Search · [Plus] · Bell · Profile
  // RTL layout:  Home is leftmost (Arabic "left" = end),
  //              Profile is rightmost (Arabic "right" = start).
  // This matches the user requirement: right=Profile+Bell, center=Plus, left=Search+Home.
  const regularItems = [
    { id: "feed",    path: "/feed",    icon: Home,   labelKey: "nav_feed"    as const, size: 22, side: "left"  },
    { id: "explore", path: "/explore", icon: Search, labelKey: "nav_explore" as const, size: 22, side: "left"  },
    { id: "profile", path: "/profile", icon: User,   labelKey: "nav_profile" as const, size: 22, side: "right" },
  ];

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-50 px-4"
      style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))" }}
    >
      <div className="relative flex items-center justify-between bg-[#0e0e14]/95 backdrop-blur-xl border border-white/8 rounded-2xl px-6 py-3 shadow-2xl shadow-black/60">

        {/* Left side: Home, Search */}
        <div className="flex items-center gap-1">
          {regularItems.filter(i => i.side === "left").map((item) => {
            const isActive = location.startsWith(item.path);
            const Icon = item.icon;
            return (
              <Link key={item.id} href={item.path} className="cursor-pointer">
                <motion.div
                  whileTap={{ scale: 0.85 }}
                  className="relative flex flex-col items-center justify-center gap-0.5"
                  style={{ minWidth: 48, minHeight: 48 }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-xl bg-primary/12"
                      transition={{ type: "spring", damping: 26, stiffness: 380 }}
                    />
                  )}
                  <Icon
                    size={item.size}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={cn("relative z-10 transition-colors duration-200", isActive ? "text-primary" : "text-white/35")}
                  />
                  <span className={cn("relative z-10 text-[10px] font-semibold tracking-wide transition-colors", isActive ? "text-primary" : "text-white/30")}>
                    {t(item.labelKey)}
                  </span>
                  {isActive && (
                    <motion.div
                      layoutId="nav-active-dot"
                      className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary"
                      transition={{ type: "spring", damping: 26, stiffness: 380 }}
                    />
                  )}
                </motion.div>
              </Link>
            );
          })}
        </div>

        {/* Center: Plus (lifted) */}
        <Link href="/create">
          <motion.div
            whileTap={{ scale: 0.88 }}
            className="w-14 h-14 -mt-8 rounded-2xl bg-primary flex items-center justify-center text-white shadow-[0_0_24px_rgba(139,92,246,0.6)] cursor-pointer border-2 border-primary/60"
          >
            <Plus size={26} strokeWidth={2.5} />
          </motion.div>
        </Link>

        {/* Right side: Bell, Profile */}
        <div className="flex items-center gap-1">
          <BellNavItem />
          {regularItems.filter(i => i.side === "right").map((item) => {
            const isActive = location.startsWith(item.path);
            const Icon = item.icon;
            return (
              <Link key={item.id} href={item.path} className="cursor-pointer">
                <motion.div
                  whileTap={{ scale: 0.85 }}
                  className="relative flex flex-col items-center justify-center gap-0.5"
                  style={{ minWidth: 48, minHeight: 48 }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-xl bg-primary/12"
                      transition={{ type: "spring", damping: 26, stiffness: 380 }}
                    />
                  )}
                  <Icon
                    size={item.size}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={cn("relative z-10 transition-colors duration-200", isActive ? "text-primary" : "text-white/35")}
                  />
                  <span className={cn("relative z-10 text-[10px] font-semibold tracking-wide transition-colors", isActive ? "text-primary" : "text-white/30")}>
                    {t(item.labelKey)}
                  </span>
                  {isActive && (
                    <motion.div
                      layoutId="nav-active-dot"
                      className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary"
                      transition={{ type: "spring", damping: 26, stiffness: 380 }}
                    />
                  )}
                </motion.div>
              </Link>
            );
          })}
        </div>

      </div>
    </div>
  );
}
