import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { requireAdmin } from "../_lib/requireAdmin";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// GET /api/admin/auctions
// Admin only. Returns all auctions with seller info.
// Response: { auctions: AdminAuction[] }
// ---------------------------------------------------------------------------

const SELECT = `
  id, title, category, status, start_price, current_bid, bid_count, like_count,
  starts_at, ends_at, created_at, lat, lng,
  currency_code, currency_label,
  seller:profiles!seller_id (id, display_name)
`.trim();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Allowed: GET" });
      return;
    }

    const user = await requireAuth(req.headers["authorization"]);
    await requireAdmin(user);

    const { data, error } = await supabaseAdmin
      .from("auctions")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      logger.error("GET /api/admin/auctions — supabase error", error);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to fetch auctions." });
      return;
    }

    const auctions = (data ?? []).map((row: Record<string, unknown>) => {
      const seller = row["seller"] as Record<string, unknown> | null;
      return {
        id: row["id"],
        title: row["title"],
        category: row["category"],
        status: row["status"],
        startPrice: row["start_price"],
        currentBid: row["current_bid"],
        bidCount: row["bid_count"],
        startsAt: row["starts_at"] ?? null,
        endsAt: row["ends_at"],
        createdAt: row["created_at"],
        currencyCode: row["currency_code"] ?? "USD",
        currencyLabel: row["currency_label"] ?? "USD",
        lat: row["lat"] ?? null,
        lng: row["lng"] ?? null,
        seller: seller
          ? { id: seller["id"], displayName: seller["display_name"] ?? null }
          : null,
      };
    });

    res.status(200).json({ auctions });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/admin/auctions failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
