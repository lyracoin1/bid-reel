import { useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { getToken } from "@/lib/api-client";

export default function Splash() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const token = await getToken();
      if (cancelled) return;
      if (!token) {
        // REPLACE — splash is a one-shot redirect; back from /login must NOT
        // return to the splash screen.
        setLocation("/login", { replace: true });
        return;
      }
      // Authenticated users always go to /feed.
      // New-user onboarding routing is handled by login.tsx afterSignIn based
      // on the isNewUser flag from POST /auth/ensure-profile. The hasSeenInterests
      // localStorage flag is no longer used for routing — it was unreliable (cleared
      // by storage wipe or cross-device) and caused existing users to be sent back
      // through the onboarding flow incorrectly.
      // REPLACE — same reason: splash must never live in the back stack.
      setLocation("/feed", { replace: true });
    };
    void run();
    return () => { cancelled = true; };
  }, [setLocation]);

  return (
    <div className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden">
      
      {/* Abstract Background Elements */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
        <img 
          src={`${import.meta.env.BASE_URL}images/splash-bg.jpg`} 
          alt="Atmosphere"
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay"
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8"
        >
          <img 
            src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
            alt="BidReel Logo"
            className="w-32 h-32 rounded-3xl box-glow"
          />
        </motion.div>

        <motion.h1 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-5xl font-display font-bold text-white tracking-tight mb-4 text-glow"
        >
          BidReel
        </motion.h1>

        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="text-lg text-muted-foreground font-medium text-center max-w-[250px]"
        >
          Bid on anything.<br/>Watch it happen.
        </motion.p>
      </div>

      {/* Loading Indicator */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-20 flex gap-2"
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ 
              scale: [1, 1.5, 1],
              opacity: [0.3, 1, 0.3]
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2
            }}
            className="w-2.5 h-2.5 rounded-full bg-primary"
          />
        ))}
      </motion.div>
    </div>
  );
}
