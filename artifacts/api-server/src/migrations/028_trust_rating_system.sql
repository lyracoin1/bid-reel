-- =============================================================================
-- Migration 028: Trust + Rating System (Bybit-style, no stars)
-- =============================================================================
-- Adds peer-to-peer trust scoring on top of the existing auctions/bids/winners
-- pipeline. NO existing tables are modified; no architecture changes.
--
-- Concepts:
--   • A "deal" is created automatically the moment an auction transitions to
--     'ended' with a winner. One deal per auction.
--   • Each side (buyer, seller) confirms the deal as 'completed' or 'failed'.
--     Final deal status is derived:
--         both 'completed'              → completed
--         any  'failed'                 → failed
--         else                          → pending
--   • Once a deal is 'completed', each side may submit ONE rating with 5
--     boolean (👍/👎) fields. Score per rating = (positives / 5) * 100.
--
-- Exposed metrics (see view user_trust_stats at the bottom):
--   completed_sales, total_sell_deals, seller_completion_rate
--   completed_buys,  total_buy_deals,  buyer_completion_rate
--   seller_review_score, buyer_review_score
--   final_seller_score = completion * 0.85 + review * 0.15
--   final_buyer_score  = completion * 0.85 + review * 0.15
--   number_of_completed_deals
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- ─── A. auction_deals ───────────────────────────────────────────────────────
-- One row per auction that ended with a winner. Created automatically by the
-- trigger at the bottom of this migration. Drives all completion/failure stats.

CREATE TABLE IF NOT EXISTS auction_deals (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id          UUID         NOT NULL UNIQUE REFERENCES auctions(id) ON DELETE CASCADE,
  seller_id           UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  buyer_id            UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  winning_bid_id      UUID         NULL     REFERENCES bids(id) ON DELETE SET NULL,
  winning_amount      NUMERIC      NULL,
  status              TEXT         NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'completed', 'failed')),
  seller_confirmation TEXT         NOT NULL DEFAULT 'pending'
                                   CHECK (seller_confirmation IN ('pending', 'completed', 'failed')),
  buyer_confirmation  TEXT         NOT NULL DEFAULT 'pending'
                                   CHECK (buyer_confirmation IN ('pending', 'completed', 'failed')),
  failed_by           TEXT         NULL
                                   CHECK (failed_by IS NULL OR failed_by IN ('seller', 'buyer', 'both')),
  completed_at        TIMESTAMPTZ  NULL,
  failed_at           TIMESTAMPTZ  NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT auction_deals_distinct_parties CHECK (seller_id <> buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_auction_deals_seller_status
  ON auction_deals (seller_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_deals_buyer_status
  ON auction_deals (buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_deals_created
  ON auction_deals (created_at DESC);

COMMENT ON TABLE auction_deals IS
  'One row per ended auction with a winner. Tracks buyer+seller confirmations and final completion/failure status.';

-- ─── B. deal_ratings ────────────────────────────────────────────────────────
-- Boolean (👍/👎) ratings, 5 fields each. One rating per side per deal.
-- Field semantics depend on `role`:
--
--   role = 'buyer_rates_seller'
--     f1_commitment, f2_communication, f3_authenticity, f4_accuracy, f5_experience
--
--   role = 'seller_rates_buyer'
--     f1_commitment, f2_communication, f3_seriousness, f4_timeliness,  f5_experience

CREATE TABLE IF NOT EXISTS deal_ratings (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID         NOT NULL REFERENCES auction_deals(id) ON DELETE CASCADE,
  rater_id    UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ratee_id    UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT         NOT NULL
                           CHECK (role IN ('buyer_rates_seller', 'seller_rates_buyer')),
  f1          BOOLEAN      NOT NULL,
  f2          BOOLEAN      NOT NULL,
  f3          BOOLEAN      NOT NULL,
  f4          BOOLEAN      NOT NULL,
  f5          BOOLEAN      NOT NULL,
  score       NUMERIC      GENERATED ALWAYS AS (
                             (f1::int + f2::int + f3::int + f4::int + f5::int) * 100.0 / 5.0
                           ) STORED,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT deal_ratings_distinct_parties CHECK (rater_id <> ratee_id),
  CONSTRAINT deal_ratings_one_per_rater_per_deal UNIQUE (deal_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_ratings_ratee_role
  ON deal_ratings (ratee_id, role);
CREATE INDEX IF NOT EXISTS idx_deal_ratings_deal
  ON deal_ratings (deal_id);

COMMENT ON TABLE deal_ratings IS
  'Boolean (👍/👎) reviews on completed deals. 5 fields per rating; score = positives/5 * 100.';

-- ─── C. updated_at trigger on auction_deals ─────────────────────────────────
CREATE OR REPLACE FUNCTION set_auction_deals_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auction_deals_updated_at ON auction_deals;
CREATE TRIGGER trg_auction_deals_updated_at
  BEFORE UPDATE ON auction_deals
  FOR EACH ROW
  EXECUTE FUNCTION set_auction_deals_updated_at();

-- ─── D. Auto-create deal when auction ends with a winner ────────────────────
-- Fires AFTER UPDATE on auctions. Idempotent via the auction_id UNIQUE
-- constraint on auction_deals. Does nothing for ended-with-no-winner auctions.

CREATE OR REPLACE FUNCTION create_deal_on_auction_end()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('ended', 'archived')
     AND NEW.winner_id IS NOT NULL
     AND NEW.seller_id IS NOT NULL
     AND NEW.seller_id <> NEW.winner_id
  THEN
    INSERT INTO auction_deals (auction_id, seller_id, buyer_id, winning_bid_id, winning_amount)
    VALUES (
      NEW.id,
      NEW.seller_id,
      NEW.winner_id,
      NEW.winner_bid_id,
      (SELECT amount FROM bids WHERE id = NEW.winner_bid_id)
    )
    ON CONFLICT (auction_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_deal_on_auction_end ON auctions;
CREATE TRIGGER trg_create_deal_on_auction_end
  AFTER UPDATE OF status, winner_id ON auctions
  FOR EACH ROW
  EXECUTE FUNCTION create_deal_on_auction_end();

-- Backfill: create deals for all already-ended auctions that have a winner.
INSERT INTO auction_deals (auction_id, seller_id, buyer_id, winning_bid_id, winning_amount)
SELECT a.id, a.seller_id, a.winner_id, a.winner_bid_id, b.amount
  FROM auctions a
  LEFT JOIN bids b ON b.id = a.winner_bid_id
 WHERE a.status IN ('ended', 'archived')
   AND a.winner_id IS NOT NULL
   AND a.seller_id IS NOT NULL
   AND a.seller_id <> a.winner_id
ON CONFLICT (auction_id) DO NOTHING;

-- ─── E. Recompute deal status from confirmations ────────────────────────────
-- Single source of truth for deriving the final `status` column from the two
-- per-side confirmations. Called by the API route on every confirmation write.

-- Plain SQL function — no PL/pgSQL, no local record variables.
-- Same business logic:
--   both confirmations 'completed' → status='completed'
--   any  confirmation  'failed'    → status='failed'  (+ failed_by = seller|buyer|both)
--   otherwise                       → status='pending'
-- completed_at / failed_at are stamped on first transition only.
CREATE OR REPLACE FUNCTION recompute_deal_status(p_deal_id UUID)
RETURNS auction_deals
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE auction_deals AS d
     SET status = CASE
           WHEN d.seller_confirmation = 'failed' OR d.buyer_confirmation = 'failed'        THEN 'failed'
           WHEN d.seller_confirmation = 'completed' AND d.buyer_confirmation = 'completed' THEN 'completed'
           ELSE 'pending'
         END,
         failed_by = CASE
           WHEN d.seller_confirmation = 'failed' AND d.buyer_confirmation = 'failed' THEN 'both'
           WHEN d.seller_confirmation = 'failed'                                     THEN 'seller'
           WHEN d.buyer_confirmation  = 'failed'                                     THEN 'buyer'
           ELSE NULL
         END,
         completed_at = CASE
           WHEN d.seller_confirmation = 'completed'
            AND d.buyer_confirmation  = 'completed'
            AND d.completed_at IS NULL                                               THEN now()
           ELSE d.completed_at
         END,
         failed_at = CASE
           WHEN (d.seller_confirmation = 'failed' OR d.buyer_confirmation = 'failed')
            AND d.failed_at IS NULL                                                  THEN now()
           ELSE d.failed_at
         END
   WHERE d.id = p_deal_id
  RETURNING d.*;
$$;

-- ─── F. user_trust_stats view ───────────────────────────────────────────────
-- Single read for everything the API/UI needs about a user's trust profile.
-- Uses LEFT JOINs from profiles so every user is represented (even with no
-- deals). NULL final_*_score means "not yet rateable" (zero deals on that side).

CREATE OR REPLACE VIEW user_trust_stats AS
WITH seller_stats AS (
  SELECT
    seller_id AS user_id,
    COUNT(*) FILTER (WHERE status = 'completed')                AS completed_sales,
    COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))   AS total_sell_deals
  FROM auction_deals
  GROUP BY seller_id
),
buyer_stats AS (
  SELECT
    buyer_id AS user_id,
    COUNT(*) FILTER (WHERE status = 'completed')                AS completed_buys,
    COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))   AS total_buy_deals
  FROM auction_deals
  GROUP BY buyer_id
),
seller_review AS (
  SELECT ratee_id AS user_id,
         AVG(score)::numeric AS seller_review_score,
         COUNT(*)            AS seller_reviews_count
    FROM deal_ratings
   WHERE role = 'buyer_rates_seller'
   GROUP BY ratee_id
),
buyer_review AS (
  SELECT ratee_id AS user_id,
         AVG(score)::numeric AS buyer_review_score,
         COUNT(*)            AS buyer_reviews_count
    FROM deal_ratings
   WHERE role = 'seller_rates_buyer'
   GROUP BY ratee_id
)
SELECT
  p.id AS user_id,

  COALESCE(ss.completed_sales,  0) AS completed_sales,
  COALESCE(ss.total_sell_deals, 0) AS total_sell_deals,
  COALESCE(bs.completed_buys,   0) AS completed_buys,
  COALESCE(bs.total_buy_deals,  0) AS total_buy_deals,

  CASE WHEN COALESCE(ss.total_sell_deals, 0) = 0 THEN NULL
       ELSE (ss.completed_sales::numeric / ss.total_sell_deals * 100)
  END AS seller_completion_rate,

  CASE WHEN COALESCE(bs.total_buy_deals, 0) = 0 THEN NULL
       ELSE (bs.completed_buys::numeric / bs.total_buy_deals * 100)
  END AS buyer_completion_rate,

  sr.seller_review_score,
  br.buyer_review_score,
  COALESCE(sr.seller_reviews_count, 0) AS seller_reviews_count,
  COALESCE(br.buyer_reviews_count,  0) AS buyer_reviews_count,

  -- final_seller_score = completion * 0.85 + review * 0.15
  -- When the user has no reviews yet, the review component falls back to the
  -- completion rate so the final score isn't NULL the moment a deal completes.
  CASE WHEN COALESCE(ss.total_sell_deals, 0) = 0 THEN NULL
       ELSE (
         (ss.completed_sales::numeric / ss.total_sell_deals * 100) * 0.85
         + COALESCE(sr.seller_review_score, ss.completed_sales::numeric / ss.total_sell_deals * 100) * 0.15
       )
  END AS final_seller_score,

  CASE WHEN COALESCE(bs.total_buy_deals, 0) = 0 THEN NULL
       ELSE (
         (bs.completed_buys::numeric / bs.total_buy_deals * 100) * 0.85
         + COALESCE(br.buyer_review_score, bs.completed_buys::numeric / bs.total_buy_deals * 100) * 0.15
       )
  END AS final_buyer_score,

  COALESCE(ss.completed_sales, 0) + COALESCE(bs.completed_buys, 0) AS number_of_completed_deals

FROM profiles p
LEFT JOIN seller_stats  ss ON ss.user_id = p.id
LEFT JOIN buyer_stats   bs ON bs.user_id = p.id
LEFT JOIN seller_review sr ON sr.user_id = p.id
LEFT JOIN buyer_review  br ON br.user_id = p.id;

COMMENT ON VIEW user_trust_stats IS
  'Per-user trust profile: completion rates, review scores, and final weighted scores (0.85 completion + 0.15 review).';

-- ─── G. Row-Level Security ──────────────────────────────────────────────────
-- All writes happen via the API server using the service-role key.
-- Reads of deal counters are also gated through the API; the view itself is
-- accessed via the service-role client too.

ALTER TABLE auction_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_ratings  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auction_deals: service role full access" ON auction_deals;
CREATE POLICY "auction_deals: service role full access"
  ON auction_deals FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auction_deals: parties can read own" ON auction_deals;
CREATE POLICY "auction_deals: parties can read own"
  ON auction_deals FOR SELECT TO authenticated
  USING (auth.uid() = seller_id OR auth.uid() = buyer_id);

DROP POLICY IF EXISTS "deal_ratings: service role full access" ON deal_ratings;
CREATE POLICY "deal_ratings: service role full access"
  ON deal_ratings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "deal_ratings: anyone can read" ON deal_ratings;
CREATE POLICY "deal_ratings: anyone can read"
  ON deal_ratings FOR SELECT USING (true);

-- ─── H. PostgREST schema cache reload ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';
