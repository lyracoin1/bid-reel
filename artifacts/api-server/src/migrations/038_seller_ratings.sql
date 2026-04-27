-- =============================================================================
-- Migration 038: Seller Ratings System
-- =============================================================================
-- Adds a specific table for textual and tag-based seller ratings,
-- complementing the existing boolean deal_ratings system.
-- =============================================================================

CREATE TABLE IF NOT EXISTS seller_ratings (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        UUID         NOT NULL REFERENCES auction_deals(id) ON DELETE CASCADE,
  rater_user_id  UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rated_user_id  UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating_type    TEXT         NOT NULL CHECK (rating_type IN ('positive', 'negative')),
  tags           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  comment        TEXT         NULL CHECK (char_length(comment) <= 500),
  is_anonymous   BOOLEAN      NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT seller_ratings_one_per_deal UNIQUE(deal_id, rater_user_id),
  CONSTRAINT seller_ratings_no_self_rating CHECK(rater_user_id <> rated_user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_seller_ratings_deal    ON seller_ratings (deal_id);
CREATE INDEX IF NOT EXISTS idx_seller_ratings_rater   ON seller_ratings (rater_user_id);
CREATE INDEX IF NOT EXISTS idx_seller_ratings_rated   ON seller_ratings (rated_user_id);
CREATE INDEX IF NOT EXISTS idx_seller_ratings_created ON seller_ratings (created_at DESC);

COMMENT ON TABLE seller_ratings IS 'Detailed textual and tag-based reviews for sellers after a completed deal.';
