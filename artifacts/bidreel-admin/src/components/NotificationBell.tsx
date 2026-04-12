import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, X, CheckCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  adminGetNotifications,
  adminMarkNotificationRead,
  adminMarkAllNotificationsRead,
  type AdminNotification,
} from "@/services/admin-api";

const TYPE_ICON: Record<string, string> = {
  new_user: "👤",
  new_auction: "🎯",
  new_report: "🚩",
  deploy_triggered: "🚀",
};

const TYPE_COLOR: Record<string, string> = {
  new_user: "text-blue-400",
  new_auction: "text-violet-400",
  new_report: "text-red-400",
  deploy_triggered: "text-amber-400",
};

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "الآن";
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  return `منذ ${Math.floor(diff / 86400)} ي`;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await adminGetNotifications();
      setNotifications(data);
    } catch {
      // silently fail — bell is non-critical
    }
  }, []);

  // Initial load + polling every 30s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleMarkRead(id: string) {
    setLoading(true);
    try {
      await adminMarkNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await adminMarkAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative w-9 h-9 flex items-center justify-center rounded-xl transition-all",
          open
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
        aria-label="الإشعارات"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-11 z-50 w-80 bg-[#0e0e18] border border-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-white" dir="rtl">
              الإشعارات
              {unreadCount > 0 && (
                <span className="ml-2 text-xs text-red-400">({unreadCount} غير مقروء)</span>
              )}
            </span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/10"
                  title="تحديد الكل كمقروء"
                >
                  {markingAll ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <CheckCheck size={12} />
                  )}
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground w-6 h-6 flex items-center justify-center rounded-lg hover:bg-muted/50"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                لا توجد إشعارات
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex gap-3 px-4 py-3 transition-colors",
                    !n.is_read ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/30",
                  )}
                  dir="rtl"
                >
                  {/* Icon */}
                  <span className="text-lg shrink-0 mt-0.5">
                    {TYPE_ICON[n.type] ?? "📌"}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-semibold leading-snug", TYPE_COLOR[n.type] ?? "text-foreground")}>
                      {n.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {n.message}
                    </div>
                    <div className="text-[10px] text-muted-foreground/50 mt-1">
                      {timeAgo(n.created_at)}
                    </div>
                  </div>

                  {/* Mark read */}
                  {!n.is_read && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      disabled={loading}
                      className="shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5 hover:bg-primary/60 transition-colors"
                      title="تحديد كمقروء"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-center">
              <span className="text-[10px] text-muted-foreground/50">
                آخر {notifications.length} إشعار
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
