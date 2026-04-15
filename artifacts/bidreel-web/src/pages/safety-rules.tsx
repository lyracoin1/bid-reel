import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";

const RULES = [
  { icon: "🤝", titleKey: "rule_1_title", bodyKey: "rule_1_body" },
  { icon: "👥", titleKey: "rule_2_title", bodyKey: "rule_2_body" },
  { icon: "🔍", titleKey: "rule_3_title", bodyKey: "rule_3_body" },
  { icon: "⚠️", titleKey: "rule_4_title", bodyKey: "rule_4_body" },
  { icon: "🚫", titleKey: "rule_5_title", bodyKey: "rule_5_body" },
] as const;

export default function SafetyRules() {
  const [, setLocation] = useLocation();
  const { t, dir } = useLang();

  return (
    <div dir={dir} className="relative w-full min-h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/10 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center gap-4 px-5 pt-14 pb-5 border-b border-white/6">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => setLocation("/profile")}
          className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white/60 hover:text-white shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </motion.button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
            <ShieldAlert size={17} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-none">{t("safety_rules")}</h1>
          </div>
        </div>
      </div>

      {/* Rules list */}
      <div className="relative z-10 flex flex-col gap-3 px-5 pt-6 pb-12">
        {RULES.map((rule, i) => (
          <motion.div
            key={rule.titleKey}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.07 * i }}
            className="flex items-start gap-4 p-5 rounded-2xl bg-white/4 border border-white/8"
          >
            <span className="text-2xl leading-none mt-0.5 shrink-0">{rule.icon}</span>
            <div>
              <p className="text-sm font-bold text-white mb-1.5">{t(rule.titleKey)}</p>
              <p className="text-sm text-white/55 leading-relaxed">{t(rule.bodyKey)}</p>
            </div>
          </motion.div>
        ))}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-xs text-white/25 text-center mt-2 px-4"
        >
          BidReel · {t("safety_rules")}
        </motion.p>
      </div>
    </div>
  );
}
