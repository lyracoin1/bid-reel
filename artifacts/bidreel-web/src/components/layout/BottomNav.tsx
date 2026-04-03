import { Link, useLocation } from "wouter";
import { Home, Search, Plus, User } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";

export function BottomNav() {
  const [location] = useLocation();
  const { t } = useLang();

  const navItems = [
    { id: "feed",    path: "/feed",    icon: Home,   labelKey: "nav_feed"    as const, size: 22 },
    { id: "explore", path: "/explore", icon: Search, labelKey: "nav_explore" as const, size: 22 },
    { id: "create",  path: "/create",  icon: Plus,   labelKey: "nav_sell"    as const, isAction: true },
    { id: "profile", path: "/profile", icon: User,   labelKey: "nav_profile" as const, size: 22 },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 px-4" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))" }}>
      <div className="relative flex items-center justify-between bg-[#0e0e14]/95 backdrop-blur-xl border border-white/8 rounded-2xl px-6 py-3 shadow-2xl shadow-black/60">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.path);
          const Icon = item.icon;

          if (item.isAction) {
            return (
              <Link key={item.id} href={item.path}>
                <motion.div
                  whileTap={{ scale: 0.88 }}
                  className="w-14 h-14 -mt-8 rounded-2xl bg-primary flex items-center justify-center text-white shadow-[0_0_24px_rgba(139,92,246,0.6)] cursor-pointer border-2 border-primary/60"
                >
                  <Icon size={26} strokeWidth={2.5} />
                </motion.div>
              </Link>
            );
          }

          const iconSize = (item as { size?: number }).size ?? 22;

          return (
            <Link key={item.id} href={item.path} className="cursor-pointer">
              <motion.div whileTap={{ scale: 0.85 }} className="flex flex-col items-center gap-0.5 w-12">
                <Icon
                  size={iconSize}
                  strokeWidth={isActive ? 2.5 : 1.8}
                  className={cn("transition-colors duration-200", isActive ? "text-primary" : "text-white/35")}
                />
                <span className={cn("text-[10px] font-semibold tracking-wide transition-colors", isActive ? "text-primary" : "text-white/30")}>
                  {t(item.labelKey)}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
