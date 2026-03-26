import { useState } from "react";
import { useLocation } from "wouter";
import { Camera, Upload, ArrowRight, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useCreateAuction } from "@/hooks/use-auctions";

export default function CreateAuction() {
  const [, setLocation] = useLocation();
  const { mutate: create, isPending } = useCreateAuction();
  
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    startingBid: ""
  });

  const handleSubmit = async () => {
    if (!formData.title || !formData.startingBid) return;
    
    const id = await create({
      title: formData.title,
      description: formData.description,
      startingBid: parseInt(formData.startingBid),
      // Mock random image for realism
      mediaUrl: `https://images.unsplash.com/photo-${Math.floor(Math.random() * 1000000)}?w=800&h=1400&fit=crop`
    });
    
    setLocation(`/auction/${id}`);
  };

  return (
    <MobileLayout showNav={false}>
      <div className="min-h-full bg-background flex flex-col p-6">
        
        {/* Header */}
        <div className="flex items-center justify-between mt-4 mb-8">
          <h1 className="text-2xl font-bold font-display">New Listing</h1>
          <div className="flex gap-1">
            <div className={`h-1.5 w-8 rounded-full ${step >= 1 ? 'bg-primary' : 'bg-secondary'}`} />
            <div className={`h-1.5 w-8 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-secondary'}`} />
          </div>
        </div>

        {step === 1 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 flex flex-col"
          >
            <p className="text-muted-foreground mb-6">Upload a short vertical video showing off your item's best details.</p>
            
            <div className="flex-1 border-2 border-dashed border-white/10 rounded-3xl bg-secondary/30 flex flex-col items-center justify-center p-8 text-center cursor-pointer hover:bg-secondary/50 hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 rounded-full bg-primary/20 text-primary flex items-center justify-center mb-4">
                <Upload size={28} />
              </div>
              <h3 className="font-bold text-lg mb-2">Select Video</h3>
              <p className="text-sm text-muted-foreground">MP4, MOV up to 60s</p>
            </div>

            <div className="mt-6 flex justify-between gap-4">
              <button className="flex-1 py-4 rounded-2xl bg-secondary text-white font-bold flex items-center justify-center gap-2">
                <Camera size={20} />
                Record
              </button>
              <button 
                onClick={() => setStep(2)}
                className="flex-1 py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 box-glow"
              >
                Next
                <ArrowRight size={20} />
              </button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 flex flex-col"
          >
            <div className="space-y-6 flex-1">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Item Title</label>
                <input 
                  type="text" 
                  value={formData.title}
                  onChange={e => setFormData({...formData, title: e.target.value})}
                  placeholder="e.g. Vintage Rolex Submariner"
                  className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-4 text-white placeholder:text-white/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Starting Bid ($)</label>
                <input 
                  type="number" 
                  value={formData.startingBid}
                  onChange={e => setFormData({...formData, startingBid: e.target.value})}
                  placeholder="0.00"
                  className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-4 text-white text-xl font-bold placeholder:text-white/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Description</label>
                <textarea 
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Describe condition, history, included items..."
                  rows={4}
                  className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-4 text-white placeholder:text-white/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none"
                />
              </div>
              
              <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-start gap-3">
                <CheckCircle2 className="text-primary shrink-0 mt-0.5" size={20} />
                <p className="text-sm text-primary/90">
                  Auctions run for exactly 3 days. Winners will contact you via WhatsApp to arrange payment and shipping.
                </p>
              </div>
            </div>

            <div className="mt-8 flex gap-4">
              <button 
                onClick={() => setStep(1)}
                className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center shrink-0"
              >
                <ArrowLeft size={24} />
              </button>
              <motion.button 
                whileTap={{ scale: 0.98 }}
                onClick={handleSubmit}
                disabled={isPending || !formData.title || !formData.startingBid}
                className="flex-1 py-4 rounded-2xl bg-primary text-white font-bold text-lg box-glow disabled:opacity-50 disabled:shadow-none relative"
              >
                {isPending ? "Publishing..." : "Publish Auction"}
              </motion.button>
            </div>
          </motion.div>
        )}

      </div>
    </MobileLayout>
  );
}

// Temporary inline import until missing icon is noticed
import { ArrowLeft } from "lucide-react";
