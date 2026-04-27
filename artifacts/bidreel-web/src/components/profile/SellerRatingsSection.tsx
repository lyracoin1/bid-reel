import { useState, useEffect } from "react";
import { Star, ThumbsUp, MessageSquare, Shield } from "lucide-react";
import { getSellerRatingsApi, type SellerRatingsSummary } from "@/lib/api-client";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useLang } from "@/contexts/LanguageContext";

interface SellerRatingsSectionProps {
  userId: string;
}

export function SellerRatingsSection({ userId }: SellerRatingsSectionProps) {
  const { t, lang } = useLang();
  const [data, setData] = useState<SellerRatingsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    getSellerRatingsApi(userId)
      .then(setData)
      .catch(err => console.error("Failed to load ratings", err))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 bg-white/5 rounded-2xl border border-white/8" />
        <div className="space-y-3">
          <div className="h-20 bg-white/5 rounded-xl border border-white/8" />
          <div className="h-20 bg-white/5 rounded-xl border border-white/8" />
        </div>
      </div>
    );
  }

  if (!data || data.stats.total === 0) return null;

  return (
    <div className="space-y-4">
      {/* Header / Summary */}
      <div className="flex items-center gap-2 mb-1">
        <Star size={14} className="text-white/40" />
        <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">
          {lang === "ar" ? "تقييمات البائع" : "Seller Ratings"}
        </span>
      </div>

      <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-white">{data.stats.positive_percentage}%</span>
              <span className="text-xs text-white/40">{lang === "ar" ? "إيجابي" : "positive"}</span>
            </div>
            <p className="text-xs text-white/40 mt-0.5">
              {lang === "ar" 
                ? `${data.stats.total} تقييم` 
                : `${data.stats.total} ratings`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end max-w-[60%]">
            {data.stats.common_tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-medium text-primary">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Recent Ratings List */}
        <div className="space-y-3">
          {data.ratings.slice(0, 3).map(rating => (
            <div key={rating.id} className="bg-white/4 border border-white/8 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <UserAvatar
                    src={rating.rater?.avatar_url ?? null}
                    name={rating.rater?.display_name ?? "User"}
                    size={20}
                    className="rounded-lg"
                  />
                  <span className="text-[11px] font-bold text-white/80">
                    {rating.is_anonymous 
                      ? (lang === "ar" ? "مستخدم مجهول" : "Anonymous User")
                      : (rating.rater?.display_name || "User")}
                  </span>
                </div>
                <div className={`flex items-center gap-1 text-[10px] font-bold ${
                  rating.rating_type === "positive" ? "text-emerald-400" : "text-red-400"
                }`}>
                  {rating.rating_type === "positive" ? <ThumbsUp size={10} /> : <ThumbsUp size={10} className="rotate-180" />}
                  <span>{rating.rating_type === "positive" ? (lang === "ar" ? "إيجابي" : "Positive") : (lang === "ar" ? "سلبي" : "Negative")}</span>
                </div>
              </div>

              {rating.comment && (
                <p className="text-xs text-white/70 mb-2 leading-relaxed" dir="auto">
                  {rating.comment}
                </p>
              )}

              <div className="flex flex-wrap gap-1">
                {rating.tags.map(tag => (
                  <span key={tag} className="text-[9px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {data.stats.total > 3 && (
          <button className="w-full mt-3 py-2 text-[11px] font-bold text-white/40 hover:text-white/60 transition-colors border-t border-white/5 pt-3">
            {lang === "ar" 
              ? `عرض جميع التقييمات (${data.stats.total})` 
              : `View all ${data.stats.total} ratings`}
          </button>
        )}
      </div>
    </div>
  );
}
