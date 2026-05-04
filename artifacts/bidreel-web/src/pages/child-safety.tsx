import { useLocation } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";

export default function ChildSafetyPage() {
  const [, setLocation] = useLocation();

  return (
    <MobileLayout>
      <div className="min-h-full bg-background">
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation(-1 as unknown as string)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400" />
            <h1 className="text-base font-bold text-white">Child Safety Standards</h1>
          </div>
        </div>

        <article className="px-5 py-6 space-y-6 text-sm text-white/75 leading-relaxed max-w-2xl mx-auto">
          <p className="text-white/40 text-xs">Last updated: May 2026</p>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Our commitment</h2>
            <p>
              BidReel, developed and operated by BidReel, is committed to
              maintaining a safe environment for all users and to the absolute
              protection of children from exploitation, abuse, and harm. This
              page describes our child safety standards, our zero-tolerance
              policy toward child sexual abuse and exploitation (CSAE), and how
              users can report concerns.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Zero tolerance for CSAE</h2>
            <p>
              BidReel has a strict zero-tolerance policy toward child sexual
              abuse material (CSAM) and any form of child sexual abuse or
              exploitation (CSAE). The following content and behaviour are
              absolutely prohibited on BidReel:
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/65 pl-2">
              <li>Any image, video, or other media that sexually exploits or abuses a minor</li>
              <li>Grooming, solicitation, or enticement of minors for sexual purposes</li>
              <li>Sharing, distributing, or linking to child sexual abuse material (CSAM)</li>
              <li>Using BidReel to facilitate trafficking or exploitation of children</li>
              <li>Any content that sexualises or endangers the safety of a child</li>
            </ul>
            <p>
              Violations of this policy will result in immediate and permanent
              account termination, removal of the content, and reporting to the
              relevant authorities including the National Center for Missing
              &amp; Exploited Children (NCMEC) and local law enforcement.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">How to report child safety concerns</h2>
            <p>
              If you encounter any content or behaviour on BidReel that you
              believe endangers a child or violates our child safety standards,
              please report it immediately using one of the following methods:
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/65 pl-2">
              <li>
                <strong className="text-white/80">In-app reporting:</strong>{" "}
                Tap the flag or report icon on any listing or user profile to
                submit a report directly to our moderation team.
              </li>
              <li>
                <strong className="text-white/80">Email:</strong>{" "}
                Send a detailed report to{" "}
                <a
                  href="mailto:safety@bid-reel.com"
                  className="text-emerald-400 underline underline-offset-2"
                >
                  safety@bid-reel.com
                </a>
                . Include as much detail as possible — a description of the
                content or behaviour, the username or listing involved, and
                any screenshots if you have them.
              </li>
              <li>
                <strong className="text-white/80">NCMEC CyberTipline:</strong>{" "}
                You can also report CSAM directly to the National Center for
                Missing &amp; Exploited Children at{" "}
                <a
                  href="https://www.missingkids.org/gethelpnow/cybertipline"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline underline-offset-2"
                >
                  missingkids.org/cybertipline
                </a>
                .
              </li>
            </ul>
            <p>
              All child safety reports are treated with the highest priority.
              We aim to review every report within 24 hours.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Moderation and enforcement</h2>
            <p>
              BidReel employs the following measures to detect, remove, and
              prevent child-harmful content:
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/65 pl-2">
              <li>
                <strong className="text-white/80">Human review:</strong>{" "}
                Reports of child safety violations are escalated immediately to
                a dedicated safety reviewer for manual investigation.
              </li>
              <li>
                <strong className="text-white/80">Account action:</strong>{" "}
                Accounts found to have uploaded, shared, or solicited CSAE
                content are permanently banned without appeal.
              </li>
              <li>
                <strong className="text-white/80">Content removal:</strong>{" "}
                Violating content is removed as soon as it is confirmed, and
                the associated data is preserved for law-enforcement purposes.
              </li>
              <li>
                <strong className="text-white/80">Law enforcement reporting:</strong>{" "}
                BidReel will report confirmed CSAM to NCMEC and cooperate
                fully with law enforcement investigations.
              </li>
              <li>
                <strong className="text-white/80">Ongoing review:</strong>{" "}
                We continuously review our safety policies and update them to
                meet evolving best practices and regulatory requirements.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Compliance with child safety laws</h2>
            <p>
              BidReel complies with all applicable laws and regulations
              concerning child safety and the protection of minors, including
              but not limited to:
            </p>
            <ul className="list-disc list-inside space-y-1 text-white/65 pl-2">
              <li>The PROTECT Our Children Act (USA)</li>
              <li>COPPA — Children's Online Privacy Protection Act (USA)</li>
              <li>The UK Online Safety Act</li>
              <li>EU General Data Protection Regulation (GDPR) provisions for minors</li>
              <li>
                Google Play's Child Safety Policy and Developer Program
                Policies, including the requirement to prohibit CSAE
              </li>
            </ul>
            <p>
              BidReel does not knowingly allow users under the age of 18 to
              create accounts. If we discover that a user is under 18, their
              account will be removed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-white font-semibold text-base">Contact</h2>
            <p>
              For child safety concerns, contact our dedicated safety team at{" "}
              <a
                href="mailto:safety@bid-reel.com"
                className="text-emerald-400 underline underline-offset-2"
              >
                safety@bid-reel.com
              </a>
              . For general support, write to{" "}
              <a
                href="mailto:support@bid-reel.com"
                className="text-primary underline underline-offset-2"
              >
                support@bid-reel.com
              </a>
              .
            </p>
            <p className="text-white/40 text-xs pt-2">
              BidReel · child safety policy · May 2026
            </p>
          </section>
        </article>
      </div>
    </MobileLayout>
  );
}
