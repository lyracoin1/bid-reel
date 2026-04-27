/**
 * DealDetailPage — single deal view with confirm + rate flow.
 *
 * Route: /deals/:dealId
 *
 * Backend: GET /api/deals/:id, POST /api/deals/:id/confirm, POST /api/deals/:id/rate
 */

import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, AlertCircle, Star,
  ShieldCheck, ShieldAlert,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import {
  getDealApi, confirmDealApi, rateDealApi,
  type ApiDealDetail, type ApiDealRating, type DealConfirmation,
} from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { invalidateTrust } from "@/hooks/use-user-trust";
import { useLang } from "@/contexts/LanguageContext";
import type { TKey } from "@/lib/i18n";

type ConfirmOutcome = "completed" | "failed";

const CONFIRMATION_META: Record<DealConfirmation, { labelKey: TKey; cls: string; icon: typeof Clock }> = {
  pending:   { labelKey: "deal_status_pending",   cls: "text-white/45",     icon: Clock },
  completed: { labelKey: "deal_status_completed", cls: "text-emerald-300",  icon: CheckCircle2 },
  failed:    { labelKey: "deal_status_failed",    cls: "text-red-300",      icon: XCircle },
};

/**
 * Status copy is role-aware. Returns translation keys + a possible sub key
 * that branches between "your turn" and "the other side's turn".
 */
function statusMetaFor(deal: Pick<ApiDealDetail, "status" | "role">): { labelKey: TKey; cls: string; subKey: TKey } {
  const isMyTurn =
    (deal.status === "pending_buyer" && deal.role === "buyer") ||
    (deal.status === "pending_seller" && deal.role === "seller");

  switch (deal.status) {
    case "pending_buyer":
    case "pending_seller":
      return isMyTurn
        ? { labelKey: "deal_detail_status_awaiting_your", cls: "text-amber-300", subKey: "deal_status_sub_your_turn" }
        : {
            labelKey: deal.status === "pending_buyer"
              ? "deal_detail_status_awaiting_buyer"
              : "deal_detail_status_awaiting_seller",
            cls: "text-amber-300",
            subKey: "deal_status_sub_other_turn",
          };
    case "pending_both":
      return { labelKey: "deal_detail_status_pending_both", cls: "text-white/60", subKey: "deal_status_sub_both_pending" };
    case "completed":
      return { labelKey: "deal_detail_status_completed", cls: "text-emerald-300", subKey: "deal_status_sub_completed" };
    case "failed":
      return { labelKey: "deal_detail_status_failed", cls: "text-red-300", subKey: "deal_status_sub_failed" };
    case "disputed":
      return { labelKey: "deal_detail_status_disputed", cls: "text-orange-300", subKey: "deal_status_sub_disputed" };
    default:
      console.warn("Unknown deal status", deal.status);
      return { labelKey: "deal_status_failed" as TKey, cls: "text-white/40", subKey: "deal_status_sub_failed" as TKey };
  }
}

const OUTCOME_LABEL_KEY: Record<DealConfirmation, TKey> = {
  pending: "deal_outcome_pending",
  completed: "deal_outcome_completed",
  failed: "deal_outcome_failed",
};

export default function DealDetailPage() {
  const { t } = useLang();
  const [, params] = useRoute("/deals/:dealId");
  const [, setLocation] = useLocation();
  const dealId = params?.dealId ?? "";

  const { user } = useCurrentUser();

  const [deal, setDeal] = useState<ApiDealDetail | null>(null);
  const [ratings, setRatings] = useState<ApiDealRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [confirming, setConfirming] = useState<ConfirmOutcome | null>(null);
  const [rateBusy, setRateBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 5 boolean fields
  const [f1, setF1] = useState<boolean | null>(null); // commitment
  const [f2, setF2] = useState<boolean | null>(null); // communication
  const [f3, setF3] = useState<boolean | null>(null); // authenticity OR seriousness
  const [f4, setF4] = useState<boolean | null>(null); // accuracy OR timeliness
  const [f5, setF5] = useState<boolean | null>(null); // experience

  function load() {
    if (!dealId) return;
    setLoading(true);
    setError(null);
    getDealApi(dealId)
      .then(({ deal, ratings }) => { setDeal(deal); setRatings(ratings); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t("deal_load_one_failed")))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dealId]);

  if (loading) {
    return (
      <MobileLayout showNav={true}>
        <div className="min-h-full flex items-center justify-center">
          <Loader2 className="animate-spin text-white/40" size={24} />
        </div>
      </MobileLayout>
    );
  }

  if (error || !deal) {
    return (
      <MobileLayout showNav={true}>
        <div className="min-h-full px-5 pt-20 text-center">
          <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-300">{error ?? t("deal_not_found")}</p>
          <button onClick={() => setLocation("/deals")} className="mt-4 text-sm text-primary underline">
            {t("deal_back_to_deals")}
          </button>
        </div>
      </MobileLayout>
    );
  }

  const isSeller = deal.role === "seller";
  const isBuyer = deal.role === "buyer";
  const myConfirmation: DealConfirmation = isSeller ? deal.seller_confirmation : deal.buyer_confirmation;
  const otherConfirmation: DealConfirmation = isSeller ? deal.buyer_confirmation : deal.seller_confirmation;

  const callerRating = ratings.find(r => user && r.rater_id === user.id);
  const canRate = deal.status === "completed" && !callerRating;
  const allFieldsAnswered = [f1, f2, f3, f4, f5].every(v => v !== null);

  // Field labels (role-dependent for f3/f4)
  const fields: { key: "f1" | "f2" | "f3" | "f4" | "f5"; label: string; help: string; value: boolean | null; set: (v: boolean) => void }[] = [
    {
      key: "f1",
      label: t("deal_field_commitment"),
      help: isBuyer ? t("deal_help_commitment_buyer") : t("deal_help_commitment_seller"),
      value: f1, set: setF1,
    },
    {
      key: "f2",
      label: t("deal_field_communication"),
      help: t("deal_help_communication"),
      value: f2, set: setF2,
    },
    isBuyer
      ? { key: "f3", label: t("deal_field_authenticity"), help: t("deal_help_authenticity"), value: f3, set: setF3 }
      : { key: "f3", label: t("deal_field_seriousness"),  help: t("deal_help_seriousness"),  value: f3, set: setF3 },
    isBuyer
      ? { key: "f4", label: t("deal_field_accuracy"),    help: t("deal_help_accuracy"),    value: f4, set: setF4 }
      : { key: "f4", label: t("deal_field_timeliness"),  help: t("deal_help_timeliness"),  value: f4, set: setF4 },
    {
      key: "f5",
      label: t("deal_field_experience"),
      help: t("deal_help_experience"),
      value: f5, set: setF5,
    },
  ];

  async function handleConfirm(outcome: ConfirmOutcome) {
    setConfirming(outcome);
    setActionError(null);
    try {
      await confirmDealApi(dealId, outcome);
      if (deal) {
        invalidateTrust(deal.seller_id);
        invalidateTrust(deal.buyer_id);
      }
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("deal_confirm_failed"));
    } finally {
      setConfirming(null);
    }
  }

  async function handleRate() {
    if (!allFieldsAnswered) return;
    setRateBusy(true);
    setActionError(null);
    try {
      const payload = isBuyer
        ? { commitment: f1!, communication: f2!, authenticity: f3!, accuracy: f4!, experience: f5! }
        : { commitment: f1!, communication: f2!, seriousness: f3!, timeliness: f4!, experience: f5! };
      await rateDealApi(dealId, payload);
      if (deal) {
        invalidateTrust(deal.seller_id);
        invalidateTrust(deal.buyer_id);
      }
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("deal_rate_failed"));
    } finally {
      setRateBusy(false);
    }
  }

  const status = statusMetaFor(deal);
  const myConfirmationLabel = t(OUTCOME_LABEL_KEY[myConfirmation]);
  const otherConfirmationLabel = t(OUTCOME_LABEL_KEY[otherConfirmation]);

  return (
    <MobileLayout showNav={true}>
      <div className="min-h-full bg-background pb-12">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-14 pb-4">
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/deals")}
            className="w-10 h-10 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center active:scale-90 transition-transform shrink-0"
          >
            <ArrowLeft size={18} className="text-white" />
          </button>
          <h1 className="text-base font-bold text-white truncate">{t("deal_details")}</h1>
        </div>

        <div className="px-5 space-y-4">
          {/* Summary card */}
          <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                isSeller
                  ? "text-blue-300 bg-blue-500/10 border-blue-500/25"
                  : "text-purple-300 bg-purple-500/10 border-purple-500/25"
              }`}>
                {isSeller ? t("deal_role_seller") : t("deal_role_buyer")}
              </span>
              <span className="text-xs text-white/40">{new Date(deal.created_at).toLocaleDateString()}</span>
            </div>

            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-3xl font-bold text-white tabular-nums">
                {Number(deal.winning_amount).toLocaleString()}
              </span>
              <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">{t("deal_winning_bid")}</span>
            </div>

            <button
              onClick={() => setLocation(`/auction/${deal.auction_id}`)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t("deal_view_auction")}
            </button>
          </div>

          {/* Status card */}
          <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
            <p className={`text-sm font-bold ${status.cls}`}>{t(status.labelKey)}</p>
            <p className="text-xs text-white/55 mt-1">{t(status.subKey)}</p>

            {/* Confirmation slots */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              {(["seller", "buyer"] as const).map(side => {
                const conf: DealConfirmation = side === "seller" ? deal.seller_confirmation : deal.buyer_confirmation;
                const rawMeta = (CONFIRMATION_META as Record<string, typeof CONFIRMATION_META.pending | undefined>)[conf];
                if (!rawMeta) console.warn("Unknown deal confirmation", conf);
                const meta = rawMeta ?? CONFIRMATION_META.pending;
                const Icon = meta.icon;
                const isMe = (side === "seller" && isSeller) || (side === "buyer" && isBuyer);
                return (
                  <div key={side} className="bg-white/4 border border-white/8 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                        {side === "seller" ? t("deal_party_seller") : t("deal_party_buyer")}
                      </span>
                      {isMe && <span className="text-[9px] font-bold text-primary">{t("deal_party_you")}</span>}
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs font-semibold ${meta.cls}`}>
                      <Icon size={12} />
                      <span>{t(meta.labelKey)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Confirm action */}
          {myConfirmation === "pending" && deal.status !== "completed" && deal.status !== "failed" && (
            <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
              <p className="text-sm font-bold text-white mb-1">{t("deal_confirm_question")}</p>
              <p className="text-xs text-white/55 mb-4">
                {otherConfirmation !== "pending"
                  ? t("deal_confirm_help_other_marked").replace("{outcome}", otherConfirmationLabel)
                  : t("deal_confirm_help_solo")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={confirming !== null}
                  onClick={() => handleConfirm("completed")}
                  className="py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {confirming === "completed" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  {t("deal_confirm_yes")}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={confirming !== null}
                  onClick={() => handleConfirm("failed")}
                  className="py-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {confirming === "failed" ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
                  {t("deal_confirm_no")}
                </motion.button>
              </div>
            </div>
          )}

          {/* Already-confirmed indicator */}
          {myConfirmation !== "pending" && deal.status !== "completed" && deal.status !== "failed" && (
            <div className="bg-white/4 border border-white/8 rounded-2xl p-3 flex items-center gap-2 text-xs text-white/60">
              <ShieldCheck size={14} className="text-primary" />
              <span>{t("deal_confirm_already").replace("{outcome}", myConfirmationLabel)}</span>
            </div>
          )}

          {/* Rating form */}
          {canRate && (
            <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Star size={14} className="text-amber-400" />
                <p className="text-sm font-bold text-white">
                  {isBuyer ? t("deal_rate_title_seller") : t("deal_rate_title_buyer")}
                </p>
              </div>
              <p className="text-xs text-white/55 mb-4">
                {t("deal_rate_intro")}
              </p>

              <div className="space-y-3">
                {fields.map(field => (
                  <div key={field.key} className="bg-white/4 border border-white/8 rounded-xl p-3">
                    <p className="text-sm font-semibold text-white">{field.label}</p>
                    <p className="text-xs text-white/50 mt-0.5 mb-3">{field.help}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => field.set(true)}
                        className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                          field.value === true
                            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                            : "bg-white/4 border-white/10 text-white/55 hover:bg-white/8"
                        }`}
                      >
                        {t("deal_rate_yes")}
                      </button>
                      <button
                        onClick={() => field.set(false)}
                        className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                          field.value === false
                            ? "bg-red-500/20 border-red-500/50 text-red-300"
                            : "bg-white/4 border-white/10 text-white/55 hover:bg-white/8"
                        }`}
                      >
                        {t("deal_rate_no")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                disabled={!allFieldsAnswered || rateBusy}
                onClick={handleRate}
                className={`mt-4 w-full py-3 rounded-xl text-sm font-bold border transition-all ${
                  allFieldsAnswered && !rateBusy
                    ? "bg-primary border-primary/50 text-white"
                    : "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                }`}
              >
                {rateBusy ? <Loader2 size={15} className="animate-spin inline mr-2" /> : null}
                {t("deal_rate_submit")}
              </motion.button>
            </div>
          )}

          {/* Already rated */}
          {callerRating && (
            <div className="bg-white/4 border border-white/8 rounded-2xl p-4 flex items-start gap-3">
              <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-white">{t("deal_rated_title")}</p>
                <p className="text-xs text-white/55 mt-0.5">
                  {t("deal_rated_score_label")} <span className="font-bold text-white tabular-nums">{Math.round(Number(callerRating.score))}%</span>
                  <span className="text-white/30"> · </span>
                  {new Date(callerRating.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}

          {/* Action error */}
          {actionError && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 flex items-start gap-2">
              <ShieldAlert size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{actionError}</p>
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
