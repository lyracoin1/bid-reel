import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Camera, Upload, CheckCircle2, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useCreateAuction } from "@/hooks/use-auctions";

export default function CreateAuction() {
  const [, setLocation] = useLocation();
  const { mutate: create, isPending } = useCreateAuction();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ title: "", description: "", startingBid: "" });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.title || !form.startingBid) return;
    const id = await create({
      title: form.title,
      description: form.description,
      startingBid: parseInt(form.startingBid),
      mediaUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&h=1400&fit=crop",
    });
    setLocation(`/auction/${id}`);
  };

  return (
    <MobileLayout showNav={false}>
      <div className="min-h-full bg-background flex flex-col px-5">

        {/* Header */}
        <div className="flex items-center gap-3 pt-14 pb-6">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => step === 1 ? setLocation("/feed") : setStep(1)}
            className="w-10 h-10 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white shrink-0"
          >
            <ArrowLeft size={18} />
          </motion.button>

          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">New Listing</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Step {step} of 2 — {step === 1 ? "Upload your video" : "Add listing details"}
            </p>
          </div>

          {/* Step indicators */}
          <div className="flex gap-1.5">
            {[1, 2].map(s => (
              <div
                key={s}
                className={`h-1 rounded-full transition-all duration-300 ${
                  s <= step ? "w-8 bg-primary" : "w-4 bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col pb-8"
            >
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                Upload a short vertical video (up to 60 seconds) showing off your item.
                Good lighting and clear details help you get more bids.
              </p>

              {/* Upload zone */}
              <div className="flex-1 min-h-64 border-2 border-dashed border-white/12 rounded-3xl bg-white/3 flex flex-col items-center justify-center p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all active:scale-[0.98]">
                <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
                  <Upload size={28} className="text-primary" />
                </div>
                <h3 className="font-bold text-white text-lg mb-1">Tap to select video</h3>
                <p className="text-xs text-muted-foreground">MP4, MOV — up to 60 seconds</p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button className="py-4 rounded-2xl bg-white/6 border border-white/10 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98]">
                  <Camera size={18} />
                  Record Now
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setStep(2)}
                  className="py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-primary/30"
                >
                  Continue
                  <ArrowRight size={18} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col pb-8"
            >
              <div className="space-y-4 flex-1">

                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                    Item Title *
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={set("title")}
                    placeholder="e.g. Vintage Rolex Submariner"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all text-[15px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                    Starting Bid *
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-lg font-bold">$</span>
                    <input
                      type="number"
                      value={form.startingBid}
                      onChange={set("startingBid")}
                      placeholder="0"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3.5 text-white text-xl font-bold placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={set("description")}
                    placeholder="Condition, history, included accessories..."
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all resize-none text-[15px] leading-relaxed"
                  />
                </div>

                {/* Duration info */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/8 border border-primary/18">
                  <Clock size={18} className="text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-primary mb-0.5">3-day auction</p>
                    <p className="text-xs text-white/50 leading-relaxed">
                      Your listing runs for exactly 72 hours. The winner will contact you via WhatsApp to arrange payment.
                    </p>
                  </div>
                </div>

                {/* Authenticity */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-white/4 border border-white/8">
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/50 leading-relaxed">
                    By listing, you confirm this item is authentic and accurately described. Misrepresentation may result in account suspension.
                  </p>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSubmit}
                disabled={isPending || !form.title || !form.startingBid}
                className="mt-6 w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40 disabled:shadow-none"
              >
                {isPending ? "Publishing…" : "Publish Auction"}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MobileLayout>
  );
}
