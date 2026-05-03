import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { UserAvatar } from "@/components/ui/user-avatar";

interface BannerItem {
  id: string;
  avatar?: string | null;
  name: string;
  message: string;
  /** Called when the user taps the banner — use to navigate to the relevant page. */
  onTap?: () => void;
}

interface NotificationBannerCtx {
  showBanner: (opts: { avatar?: string | null; name: string; message: string; onTap?: () => void }) => void;
}

const Ctx = createContext<NotificationBannerCtx>({
  showBanner: () => {},
});

export function useNotificationBanner() {
  return useContext(Ctx);
}

export function NotificationBannerProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const timerMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
    timerMap.current.delete(id);
  }, []);

  const showBanner = useCallback(
    (opts: { avatar?: string | null; name: string; message: string; onTap?: () => void }) => {
      const id = `${Date.now()}-${Math.random()}`;
      const item: BannerItem = { id, ...opts };
      setBanners((prev) => [...prev.slice(-2), item]);
      const t = setTimeout(() => dismiss(id), 4000);
      timerMap.current.set(id, t);
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ showBanner }}>
      {children}
      {createPortal(
        <div
          className="fixed top-0 left-0 right-0 z-[200] flex flex-col items-center gap-2 pt-safe-top pt-3 px-3 pointer-events-none"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}
        >
          <AnimatePresence mode="popLayout">
            {banners.map((b) => (
              <motion.div
                key={b.id}
                layout
                initial={{ opacity: 0, y: -40, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -24, scale: 0.94 }}
                transition={{ type: "spring", damping: 22, stiffness: 320 }}
                className="w-full max-w-sm bg-[#111118]/95 backdrop-blur-xl border border-white/10 rounded-2xl px-3.5 py-2.5 flex items-center gap-3 shadow-xl shadow-black/60 pointer-events-auto"
                onClick={() => { dismiss(b.id); b.onTap?.(); }}
              >
                <UserAvatar src={b.avatar ?? null} name={b.name} size={34} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-white leading-none mb-0.5 truncate">
                    {b.name}
                  </p>
                  <p className="text-[12px] text-white/70 leading-snug line-clamp-1">
                    {b.message}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </Ctx.Provider>
  );
}
