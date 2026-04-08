import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// /api/auctions/:id  —  GET | DELETE
// ---------------------------------------------------------------------------

const AUCTION_SELECT = `
  *,
  seller:profiles!seller_id (
    id,
    display_name,
    avatar_url
  )
`.trim();

const BIDS_SELECT = `
  id,
  user_id,
  amount,
  created_at,
  bidder:profiles!bids_user_id_fkey (
    id,
    display_name,
    avatar_url
  )
`.trim();

// ─── GET /api/auctions/:id ───────────────────────────────────────────────────
// Public. Returns auction + bids.
// Response: { auction: ApiAuctionRaw; bids: ApiAuctionBid[] }

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const id = req.query["id"] as string;

  const [auctionResult, bidsResult] = await Promise.all([
    supabaseAdmin
      .from("auctions")
      .select(AUCTION_SELECT)
      .eq("id", id)
      .single(),
    supabaseAdmin
      .from("bids")
      .select(BIDS_SELECT)
      .eq("auction_id", id)
      .order("amount", { ascending: false }),
  ]);

  if (auctionResult.error || !auctionResult.data) {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found." });
    return;
  }

  res.status(200).json({
    auction: auctionResult.data,
    bids: bidsResult.data ?? [],
  });
}

// ─── DELETE /api/auctions/:id ────────────────────────────────────────────────
// Auth required. Only the auction's seller may delete it.

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);
  const id = req.query["id"] as string;

  const { data: auction, error: fetchError } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id")
    .eq("id", id)
    .single();

  if (fetchError || !auction) {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found." });
    return;
  }

  if ((auction as Record<string, unknown>).seller_id !== user.id) {
    res.status(403).json({ error: "FORBIDDEN", message: "You can only delete your own auctions." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("auctions")
    .delete()
    .eq("id", id);

  if (error) {
    logger.error("DELETE /api/auctions/:id failed", { error, id });
    res.status(500).json({ error: "DELETE_FAILED", message: "Failed to delete auction." });
    return;
  }

  res.status(200).json({ success: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "DELETE") return await handleDelete(req, res);

    res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "Allowed methods: GET, DELETE",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(`${req.method} /api/auctions/${req.query["id"]} failed`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
