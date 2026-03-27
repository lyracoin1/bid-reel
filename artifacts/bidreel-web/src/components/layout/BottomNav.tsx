import { Link, useLocation } from "wouter";
import { Home, Compass, Plus, User } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const navItems = [
  { id: "feed",    path: "/feed",    icon: Home,    label: "Feed" },
  { id: "explore", path: "/explore", icon: Compass, label: "Explore" },
  { id: "create",  path: "/create",  icon: Plus,    label: "Sell",    isAction: true },
  { id: "profile", path: "/profile", icon: User,    label: "Profile" },
];

export function BottomNav() {
  const [location] = useLocation();

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

          return (
            <Link key={item.id} href={item.path} className="cursor-pointer">
              <motion.div
                whileTap={{ scale: 0.85 }}
                className="flex flex-col items-center gap-0.5 w-12"
              >
                <Icon
                  size={22}
                  className={cn(
                    "transition-colors duration-200",
                    isActive ? "text-primary" : "text-white/35"
                  )}
                />
                <span className={cn(
                  "text-[10px] font-semibold tracking-wide transition-colors",
                  isActive ? "text-primary" : "text-white/30"
                )}>
                  {item.label}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
