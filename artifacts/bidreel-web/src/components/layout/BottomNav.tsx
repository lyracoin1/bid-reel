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
    { id: "explore", path: "/explore", icon: Search, labelKey: "nav_explore" as const, size: 24, prominent: true },
    { id: "create",  path: "/create",  icon: Plus,   labelKey: "nav_sell"    as const, isAction: true },
    { id: "profile", path: "/profile", icon: User,   labelKey: "nav_profile" as const, size: 22 },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 px-4 pb-5">
      <div className="relative flex items-center justify-between bg-[#111118]/90 backdrop-blur-xl border border-white/8 rounded-2xl px-5 py-3 shadow-xl shadow-black/50">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.path);
          const Icon = item.icon;

          if (item.isAction) {
            return (
              <Link key={item.id} href={item.path}>
                <motion.div
                  whileTap={{ scale: 0.88 }}
                  className="w-12 h-12 -mt-7 rounded-2xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/50 cursor-pointer"
                >
                  <Icon size={24} strokeWidth={2.5} />
                </motion.div>
              </Link>
            );
          }

          const iconSize = (item as any).size ?? 22;
          const isProminent = (item as any).prominent;

          return (
            <Link key={item.id} href={item.path} className="cursor-pointer">
              <motion.div
                whileTap={{ scale: 0.85 }}
                className="flex flex-col items-center gap-0.5 w-12"
              >
                {isProminent ? (
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200",
                    isActive
                      ? "bg-primary/20 text-primary shadow-sm shadow-primary/20"
                      : "bg-white/6 text-white/50"
                  )}>
                    <Icon size={iconSize} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                ) : (
                  <Icon size={iconSize} className={cn("transition-colors duration-200", isActive ? "text-primary" : "text-white/35")} />
                )}
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
