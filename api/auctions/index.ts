import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// /api/auctions  —  GET | POST
// ---------------------------------------------------------------------------

const AUCTION_DURATION_MS = 72 * 60 * 60 * 1000; // 72 hours

const AUCTION_SELECT = `
  *,
  seller:profiles!seller_id (
    id,
    display_name,
    avatar_url,
    phone
  )
`.trim();

// ─── GET /api/auctions ───────────────────────────────────────────────────────
// Public: returns active auctions newest-first.
// Response: { auctions: ApiAuctionRaw[] }

async function handleGet(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("auctions")
    .select(AUCTION_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error("GET /api/auctions: fetch failed", { error });
    res.status(500).json({ error: "FETCH_FAILED", message: "Failed to fetch auctions." });
    return;
  }

  res.status(200).json({ auctions: data ?? [] });
}

// ─── POST /api/auctions ──────────────────────────────────────────────────────
// Auth required. Creates a new 72-hour auction.
// Response: { auction: ApiAuctionRaw }

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(120),
  description: z.string().max(500).optional(),
  category: z.string().min(1, "Category is required"),
  startPrice: z.number().int().positive("Starting price must be a positive integer"),
  videoUrl: z.string().url("videoUrl must be a valid URL"),
  thumbnailUrl: z.string().url("thumbnailUrl must be a valid URL"),
  lat: z.number(),
  lng: z.number(),
  currencyCode: z.string().optional(),
  currencyLabel: z.string().optional(),
});

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const {
    title,
    description,
    category,
    startPrice,
    videoUrl,
    thumbnailUrl,
    lat,
    lng,
    currencyCode,
    currencyLabel,
  } = parsed.data;

  const now = new Date();
  const endsAt = new Date(now.getTime() + AUCTION_DURATION_MS);

  const { data, error } = await supabaseAdmin
    .from("auctions")
    .insert({
      seller_id: user.id,
      title,
      description: description ?? null,
      category,
      start_price: startPrice,
      current_bid: startPrice,
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      lat,
      lng,
      currency_code: currencyCode ?? "USD",
      currency_label: currencyLabel ?? "US Dollar",
      status: "active",
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select(AUCTION_SELECT)
    .single();

  if (error || !data) {
    logger.error("POST /api/auctions: insert failed", { error });
    res.status(500).json({ error: "CREATE_FAILED", message: "Failed to create auction." });
    return;
  }

  logger.info("POST /api/auctions: created", { id: (data as unknown as Record<string, unknown>).id });
  res.status(201).json({ auction: data });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);

    res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "Allowed methods: GET, POST",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(`${req.method} /api/auctions failed`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
