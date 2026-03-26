import { Link, useLocation } from "wouter";
import { Home, Compass, Plus, User } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const [location] = useLocation();

  const navItems = [
    { id: "feed", path: "/feed", icon: Home, label: "Feed" },
    { id: "explore", path: "/explore", icon: Compass, label: "Explore" },
    { id: "create", path: "/create", icon: Plus, label: "Sell", isAction: true },
    { id: "profile", path: "/profile", icon: User, label: "Profile" },
  ];

  return (
    <div className="absolute bottom-0 w-full z-50 px-4 pb-6 pt-4">
      <div className="glass-panel rounded-full px-6 py-3 flex justify-between items-center relative">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;

          if (item.isAction) {
            return (
              <Link key={item.id} href={item.path} className="relative -top-5">
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground box-glow cursor-pointer"
                >
                  <Icon size={28} strokeWidth={2.5} />
                </motion.div>
              </Link>
            );
          }

          return (
            <Link key={item.id} href={item.path} className="relative flex flex-col items-center justify-center w-12 cursor-pointer">
              <motion.div
                whileTap={{ scale: 0.85 }}
                className="flex flex-col items-center"
              >
                <Icon
                  size={24}
                  className={cn(
                    "transition-colors duration-300",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-white"
                  )}
                />
                {isActive && (
                  <motion.div 
                    layoutId="nav-indicator"
                    className="absolute -bottom-2 w-1.5 h-1.5 rounded-full bg-primary"
                  />
                )}
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
