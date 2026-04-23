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
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-primary" />
            <h1 className="text-base font-bold text-white">Privacy Policy</h1>
          </div>
        </div>

        <article className="px-5 py-6 space-y-6 text-sm text-white/75 leading-relaxed max-w-2xl mx-auto">
          <p className="text-white/40 text-xs">Last updated: April 2026</p>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Who we are</h2>
            <p>
              BidReel is a short-video auction app. This page explains, in plain
              language, what information we collect and how we use it.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Content you upload</h2>
            <p>
              You can upload <strong>videos and images</strong> to create
              listings on BidReel. Anything you upload is shown to other users
              of the app and stored on our servers so it can be displayed in the
              feed and on the auction detail page.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Camera and storage</h2>
            <p>
              BidReel asks for permission to use your <strong>camera</strong> so
              you can record a video or take a photo for a listing, and for
              access to your device <strong>storage / photo library</strong> so
              you can pick an existing video or image to upload. We only access
              the camera or photos when you actively choose to upload something.
              We do not browse your device in the background.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Account and profile information</h2>
            <p>
              When you create an account we may store your{" "}
              <strong>phone number</strong>, your <strong>display name</strong>,{" "}
              <strong>username</strong>, and an optional{" "}
              <strong>profile photo</strong>. Your phone number is used so
              buyers and sellers can contact each other after an auction is
              unlocked, and to help secure your account.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">How your data is stored</h2>
            <p>
              We use <strong>Supabase</strong> to handle authentication and to
              store your account data, your listings, your bids, and the media
              files you upload. Supabase keeps this data on secure cloud
              servers on our behalf.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Sharing</h2>
            <p>
              We do not sell your personal information. Other users of the app
              can see the public parts of your profile (display name, username,
              avatar) and the listings you publish. Your phone number is only
              shared with another user once an auction has been unlocked
              between the two of you.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Deleting your data</h2>
            <p>
              You can delete a listing at any time from the app. If you want to
              delete your whole account and the data attached to it, contact us
              and we will remove it.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Contact</h2>
            <p>
              For any privacy question, write to us at{" "}
              <a
                href="mailto:support@bid-reel.com"
                className="text-primary underline underline-offset-2"
              >
                support@bid-reel.com
              </a>
              .
            </p>
          </section>
        </article>
      </div>
    </MobileLayout>
  );
}
