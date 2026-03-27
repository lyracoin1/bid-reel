import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Camera, Upload, CheckCircle2, Clock, Play, Image as ImageIcon, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useCreateAuction } from "@/hooks/use-auctions";
import { useLang } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

type PostType = "video" | "photos";

// Placeholder preview images for album demo
const DEMO_PHOTOS = [
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1495121605193-b116b5b9c0c6?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=400&h=400&fit=crop",
];

export default function CreateAuction() {
  const [, setLocation] = useLocation();
  const { mutate: create, isPending } = useCreateAuction();
  const { t } = useLang();

  const [step, setStep] = useState(1);
  const [postType, setPostType] = useState<PostType>("video");
  const [photos, setPhotos] = useState<string[]>([]);
  const [form, setForm] = useState({ title: "", description: "", startingBid: "" });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  // Demo: add placeholder photo when user taps Add
  const addDemoPhoto = () => {
    if (photos.length < 6) {
      setPhotos(prev => [...prev, DEMO_PHOTOS[prev.length % DEMO_PHOTOS.length]]);
    }
  };
  const removePhoto = (i: number) => setPhotos(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!form.title || !form.startingBid) return;
    const coverUrl = postType === "photos" && photos.length > 0
      ? photos[0]
      : "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&h=1400&fit=crop";

    const id = await create({
      title: form.title,
      description: form.description,
      startingBid: parseInt(form.startingBid),
      mediaUrl: coverUrl,
      type: postType === "photos" ? "album" : "video",
      images: postType === "photos" ? photos : undefined,
    } as any);
    setLocation(`/auction/${id}`);
  };

  return (
    <MobileLayout showNav={false}>
      <div className="min-h-full bg-background flex flex-col px-5">

        {/* Header */}
        <div className="flex items-center gap-3 pt-14 pb-6">
          <motion.button whileTap={{ scale: 0.9 }}
            onClick={() => step === 1 ? setLocation("/feed") : setStep(1)}
            className="w-10 h-10 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white shrink-0">
            <ArrowLeft size={18} />
          </motion.button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">{t("new_listing")}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Step {step} of 2 — {step === 1 ? t("step_1_label") : t("step_2_label")}
            </p>
          </div>
          <div className="flex gap-1.5">
            {[1, 2].map(s => (
              <div key={s} className={`h-1 rounded-full transition-all duration-300 ${s <= step ? "w-8 bg-primary" : "w-4 bg-white/15"}`} />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }} className="flex-1 flex flex-col pb-8">

              {/* Video / Photos toggle */}
              <div className="flex bg-white/5 border border-white/8 rounded-2xl p-1 mb-5">
                {(["video", "photos"] as PostType[]).map((pt) => (
                  <button key={pt} onClick={() => setPostType(pt)}
                    className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                    {postType === pt && (
                      <motion.div layoutId="type-tab" className="absolute inset-0 bg-primary/20 border border-primary/30 rounded-xl" />
                    )}
                    {pt === "video"
                      ? <Play size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                      : <ImageIcon size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                    }
                    <span className={cn("relative z-10 capitalize", postType === pt ? "text-white" : "text-white/40")}>
                      {t(pt === "video" ? "video" : "photos")}
                    </span>
                  </button>
                ))}
              </div>

              {/* Upload area */}
              {postType === "video" ? (
                <>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{t("upload_hint")}</p>
                  <div className="flex-1 min-h-56 border-2 border-dashed border-white/12 rounded-3xl bg-white/3 flex flex-col items-center justify-center p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all active:scale-[0.98]">
                    <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
                      <Upload size={28} className="text-primary" />
                    </div>
                    <h3 className="font-bold text-white text-lg mb-1">{t("tap_to_select_video")}</h3>
                    <p className="text-xs text-muted-foreground">MP4, MOV — up to 60s</p>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button className="py-4 rounded-2xl bg-white/6 border border-white/10 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98]">
                      <Camera size={18} />{t("record_now")}
                    </button>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(2)}
                      className="py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-primary/30">
                      {t("continue")}<ArrowRight size={18} />
                    </motion.button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    Add up to 6 photos. The first photo is the cover shown in the feed.
                  </p>

                  {/* Photo grid */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {photos.map((src, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                        <img src={src} className="w-full h-full object-cover" alt={`Photo ${i + 1}`} />
                        {i === 0 && (
                          <div className="absolute top-1 left-1 bg-primary/90 rounded px-1.5 py-0.5 text-[9px] font-bold text-white">COVER</div>
                        )}
                        <button onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center">
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                    {photos.length < 6 && (
                      <button onClick={addDemoPhoto}
                        className="aspect-square rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1 text-white/30 hover:border-primary/50 hover:text-primary/60 transition-all active:scale-[0.97]">
                        <ImageIcon size={20} />
                        <span className="text-[10px] font-medium">{t("add_photos")}</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground text-center mb-5">{photos.length}/6 photos added</p>

                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep(2)}
                    disabled={photos.length === 0}
                    className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-primary/30 disabled:opacity-40">
                    {t("continue")}<ArrowRight size={18} />
                  </motion.button>
                </>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }} className="flex-1 flex flex-col pb-8">
              <div className="space-y-4 flex-1">

                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("item_title")} *</label>
                  <input type="text" value={form.title} onChange={set("title")} placeholder={t("item_title_placeholder")}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all text-[15px]" />
                </div>

                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("starting_bid")} *</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-lg font-bold">$</span>
                    <input type="number" value={form.startingBid} onChange={set("startingBid")} placeholder="0"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3.5 text-white text-xl font-bold placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("description")}</label>
                  <textarea value={form.description} onChange={set("description")} placeholder={t("description_placeholder")} rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all resize-none text-[15px] leading-relaxed" />
                </div>

                <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/8 border border-primary/18">
                  <Clock size={18} className="text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-primary mb-0.5">{t("auction_duration_title")}</p>
                    <p className="text-xs text-white/50 leading-relaxed">{t("auction_duration_body")}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 rounded-xl bg-white/4 border border-white/8">
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/50 leading-relaxed">{t("authenticity_note")}</p>
                </div>
              </div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={handleSubmit}
                disabled={isPending || !form.title || !form.startingBid}
                className="mt-6 w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40 disabled:shadow-none">
                {isPending ? t("publishing") : t("publish")}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MobileLayout>
  );
}
