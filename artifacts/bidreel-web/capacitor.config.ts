import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bidreel.android",
  appName: "BidReel",
  webDir: "dist/public",

  server: {
    androidScheme: "https",
    allowNavigation: ["*.supabase.co"]
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: "#030305",
      showSpinner: false
    }
  },

  android: {
    minWebViewVersion: 60
  }
};

export default config;