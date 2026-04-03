import { useLocation } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";

export default function PrivacyPolicy() {
  const [, setLocation] = useLocation();

  return (
    <MobileLayout>
      <div className="min-h-full bg-background">
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation(-1 as any)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-primary" />
            <h1 className="text-base font-bold text-white">Privacy Policy</h1>
          </div>
        </div>

        <div className="px-5 py-6 space-y-6 text-sm text-white/70 leading-relaxed">
          <p className="text-white/40 text-xs">Last updated: April 2025</p>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Overview</h2>
            <p>
              BidReel ("we", "our", "the app") is a short-video auction platform. This policy explains
              what data we collect, why we collect it, and how you can request its deletion.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Data We Collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-white/90">Phone number</strong> — used for one-time password (OTP) authentication. Never shared publicly.</li>
              <li><strong className="text-white/90">Display name &amp; avatar</strong> — shown on your public profile and auction listings.</li>
              <li><strong className="text-white/90">Videos and photos</strong> — media you upload for auction listings, stored securely in cloud storage.</li>
              <li><strong className="text-white/90">Bids</strong> — amounts you bid on auctions, linked to your account.</li>
              <li><strong className="text-white/90">Location (optional)</strong> — approximate country, used only to suggest local currency. Never stored on our servers.</li>
              <li><strong className="text-white/90">Device push token</strong> — used to send you auction notifications (only when permission is granted).</li>
              <li><strong className="text-white/90">Follows and saves</strong> — who you follow and auctions you bookmark, private to your account.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To authenticate your account and maintain session security.</li>
              <li>To operate the auction system (listing items, placing bids, showing results).</li>
              <li>To send you relevant push notifications about auctions you watch or bid on.</li>
              <li>To display your public profile to other users.</li>
              <li>We do <strong className="text-white/90">not</strong> sell your data to third parties.</li>
              <li>We do <strong className="text-white/90">not</strong> use your data for advertising profiling.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Third-Party Services</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-white/90">Supabase</strong> — database and authentication provider. Your data is stored in Supabase's cloud infrastructure. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">Supabase Privacy Policy</a>.</li>
              <li><strong className="text-white/90">Firebase Cloud Messaging</strong> — used for push notifications (only if you grant permission). <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">Firebase Privacy Policy</a>.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Data Retention</h2>
            <p>
              Your data is retained while your account is active. When you delete your account,
              all personal data (phone number, display name, avatar, bids, follows, saves, and device
              tokens) is permanently deleted within 30 days. Auction listings you created will be
              anonymised rather than deleted to preserve auction integrity.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Account Deletion</h2>
            <p>
              You can permanently delete your account at any time from your Profile page. Tap the menu,
              then choose "Delete Account". Deletion is immediate and irreversible.
            </p>
            <p>
              You can also request deletion by emailing us at the address below.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Your Rights</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Request a copy of all data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your account and all associated data.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Contact</h2>
            <p>
              For privacy questions or data requests, contact us at:{" "}
              <span className="text-primary">privacy@bidreel.app</span>
            </p>
          </section>

          <div className="h-8" />
        </div>
      </div>
    </MobileLayout>
  );
}
