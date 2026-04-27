import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ratingSchema = z.object({
  dealId: z.string().uuid(),
  ratedUserId: z.string().uuid(),
  ratingType: z.enum(["positive", "negative"]),
  tags: z.array(z.string()),
  comment: z.string().max(500).optional(),
  isAnonymous: z.boolean().default(false),
});

router.post("/ratings", requireAuth, async (req, res) => {
  const raterUserId = req.user!.id;
  const validation = ratingSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({ error: "INVALID_INPUT", details: validation.error.format() });
    return;
  }

  const { dealId, ratedUserId, ratingType, tags, comment, isAnonymous } = validation.data;

  // 1. User cannot rate themselves
  if (raterUserId === ratedUserId) {
    res.status(400).json({ error: "NOT_ALLOWED_TO_RATE", message: "Cannot rate yourself." });
    return;
  }

  // 2. Fetch deal and verify
  const { data: deal, error: dealError } = await supabaseAdmin
    .from("auction_deals")
    .select("id, status, seller_id, buyer_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealError) {
    logger.error({ err: dealError.message, dealId }, "POST /ratings: fetch deal failed");
    res.status(500).json({ error: "INTERNAL_ERROR" });
    return;
  }

  if (!deal) {
    res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
    return;
  }

  // 3. Verify deal is completed
  if (deal.status !== "completed") {
    res.status(400).json({ error: "DEAL_NOT_COMPLETED", message: "Can only rate completed deals." });
    return;
  }

  // 4. Verify rater is part of the deal and ratedUserId is the other party
  const isBuyer = deal.buyer_id === raterUserId;
  const isSeller = deal.seller_id === raterUserId;

  if (!isBuyer && !isSeller) {
    res.status(403).json({ error: "NOT_ALLOWED_TO_RATE", message: "Not a party to this deal." });
    return;
  }

  const expectedRatedId = isBuyer ? deal.seller_id : deal.buyer_id;
  if (ratedUserId !== expectedRatedId) {
    res.status(400).json({ error: "INVALID_INPUT", message: "ratedUserId must be the other party in the deal." });
    return;
  }

  // 5. Insert rating
  const { data: rating, error: insertError } = await supabaseAdmin
    .from("seller_ratings")
    .insert({
      deal_id: dealId,
      rater_user_id: raterUserId,
      rated_user_id: ratedUserId,
      rating_type: ratingType,
      tags,
      comment,
      is_anonymous: isAnonymous,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") { // Unique constraint violation
      res.status(409).json({ error: "RATING_ALREADY_EXISTS" });
      return;
    }
    logger.error({ err: insertError.message, dealId, raterUserId }, "POST /ratings: insert failed");
    res.status(500).json({ error: "INTERNAL_ERROR" });
    return;
  }

  res.json({ success: true, ratingId: rating?.id });
});

// ─── GET /api/users/:userId/ratings ───────────────────────────────────────────

router.get("/users/:userId/ratings", async (req, res) => {
  const userId = req.params.userId;

  // 1. Fetch ratings with rater profile data
  const { data: ratings, error } = await supabaseAdmin
    .from("seller_ratings")
    .select(`
      id,
      rating_type,
      tags,
      comment,
      is_anonymous,
      created_at,
      rater:profiles!rater_user_id(display_name, avatar_url)
    `)
    .eq("rated_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error.message, userId }, "GET /users/:id/ratings: fetch failed");
    res.status(500).json({ error: "INTERNAL_ERROR" });
    return;
  }

  const safeRatings = (ratings || []).map(r => ({
    ...r,
    rater: r.is_anonymous ? null : r.rater,
  }));

  // 2. Compute stats
  const total = safeRatings.length;
  const positiveCount = safeRatings.filter(r => r.rating_type === "positive").length;
  const positivePercentage = total > 0 ? Math.round((positiveCount / total) * 100) : 100;

  // 3. Extract common tags (top 3)
  const tagCounts: Record<string, number> = {};
  safeRatings.forEach(r => {
    (r.tags || []).forEach((tag: string) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const commonTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);

  res.json({
    ratings: safeRatings,
    stats: {
      total,
      positive_percentage: positivePercentage,
      common_tags: commonTags,
    },
  });
});

export default router;
