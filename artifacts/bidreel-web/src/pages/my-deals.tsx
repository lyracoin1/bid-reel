/**
 * MyDealsPage — lists all deals the caller is part of (as buyer or seller).
 *
 * Route: /deals
 *
 * Backend: GET /api/deals/me  → { deals: [{ id, role, status, ... }] }
 *
 * Each row deep-links to /deals/:dealId where the user can confirm and rate.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, Handshake, CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { getMyDealsApi, type ApiDeal } from "@/lib/api-client";
import { useLang } from "@/contexts/LanguageContext";
import type { TKey } from "@/lib/i18n";

type Filter = "all" | "active" | "completed" | "failed";

/**
 * Status label depends on the viewer's role:
 *   pending_buyer  = the BUYER hasn't confirmed yet
 *   pending_seller = the SELLER hasn't confirmed yet
 * So "Awaiting you" requires checking both deal.status AND deal.role.
 */
function statusMetaFor(deal: Pick<ApiDeal, "status" | "role">): { labelKey: TKey; icon: typeof Clock; cls: string } {
  switch (deal.status) {
    case "pending_buyer":
      return {
        labelKey: deal.role === "buyer" ? "deal_status_awaiting_you" : "deal_status_awaiting_buyer",
        icon: Clock, cls: "text-amber-300",
      };
    case "pending_seller":
      return {
        labelKey: deal.role === "seller" ? "deal_status_awaiting_you" : "deal_status_awaiting_seller",
        icon: Clock, cls: "text-amber-300",
      };
    case "pending_both":
      return { labelKey: "deal_status_awaiting_both", icon: Clock, cls: "text-white/60" };
    case "completed":
      return { labelKey: "deal_status_completed", icon: CheckCircle2, cls: "text-emerald-300" };
    case "failed":
      return { labelKey: "deal_status_failed", icon: XCircle, cls: "text-red-300" };
    case "disputed":
      return { labelKey: "deal_status_disputed", icon: AlertCircle, cls: "text-orange-300" };
  }
}

export default function MyDealsPage() {
  const { t } = useLang();
  const [, setLocation] = useLocation();
  const [deals, setDeals] = useState<ApiDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMyDealsApi()
      .then(setDeals)
      .catch(() => setError(t("deal_load_failed")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = deals.filter(d => {
    if (filter === "all") return true;
    if (filter === "active") return d.status.startsWith("pending");
    if (filter === "completed") return d.status === "completed";
    if (filter === "failed") return d.status === "failed" || d.status === "disputed";
    return true;
  });

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all",       label: t("deal_filter_all"),       count: deals.length },
    { id: "active",    label: t("deal_filter_active"),    count: deals.filter(d => d.status.startsWith("pending")).length },
    { id: "completed", label: t("deal_filter_completed"), count: deals.filter(d => d.status === "completed").length },
    { id: "failed",    label: t("deal_filter_failed"),    count: deals.filter(d => d.status === "failed" || d.status === "disputed").length },
  ];

  return (
    <MobileLayout showNav={true}>
      <div className="min-h-full bg-background">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-14 pb-4">
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/profile")}
            className="w-10 h-10 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center active:scale-90 transition-transform shrink-0"
          >
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Handshake size={18} className="text-primary shrink-0" />
            <h1 className="text-base font-bold text-white truncate">{t("nav_my_deals")}</h1>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-5 mb-3">
          <div className="flex bg-white/5 border border-white/8 rounded-2xl p-1 overflow-x-auto">
            {tabs.map(tab => {
              const isActive = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className="relative flex-1 min-w-[72px] flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors"
                >
                  {isActive && <motion.div layoutId="deals-tab-bg" className="absolute inset-0 bg-white/10 rounded-xl" />}
                  <span className={isActive ? "text-white relative z-10" : "text-white/40 relative z-10"}>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full relative z-10 ${isActive ? "bg-primary/25 text-primary" : "bg-white/8 text-white/40"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-8">
          {loading ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="animate-spin text-white/40" size={24} />
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center">
                <Handshake size={22} className="text-white/20" />
              </div>
              <p className="text-sm font-semibold text-white/50">{t("deal_empty_title")}</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                {t("deal_empty_sub")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filtered.map(deal => {
                const meta = statusMetaFor(deal);
                const Icon = meta.icon;
                return (
                  <motion.button
                    key={deal.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setLocation(`/deals/${deal.id}`)}
                    className="w-full text-left bg-white/5 border border-white/8 rounded-2xl p-4 active:bg-white/8 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                          deal.role === "seller"
                            ? "text-blue-300 bg-blue-500/10 border-blue-500/25"
                            : "text-purple-300 bg-purple-500/10 border-purple-500/25"
                        }`}>
                          {deal.role === "seller" ? t("deal_role_seller") : t("deal_role_buyer")}
                        </span>
                      </div>
                      <span className="text-xs text-white/40 tabular-nums shrink-0">
                        {new Date(deal.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1.5 mb-2">
                      <span className="text-xl font-bold text-white tabular-nums">
                        {Number(deal.winning_amount).toLocaleString()}
                      </span>
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">{t("deal_winning_bid")}</span>
                    </div>

                    <div className={`flex items-center gap-1.5 text-xs font-semibold ${meta.cls}`}>
                      <Icon size={13} />
                      <span>{t(meta.labelKey)}</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
