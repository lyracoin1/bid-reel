-- Migration 040: Reset min_increment rows that carry the old server default of 10
-- back to 1 (the current default since Zod schema was updated).
--
-- Background: the createAuctionSchema previously defaulted minIncrement to 10.
-- No seller UI has ever exposed this field, so every non-null value of 10 in
-- the DB is the old automatic default, not an intentional seller preference.
-- The current Zod default is 1; new auctions already get min_increment = 1.
-- This one-off UPDATE aligns legacy rows with the new default so that bids as
-- low as 1 are accepted on all auctions, matching the advertised UX.

UPDATE auctions
SET    min_increment = 1
WHERE  min_increment = 10;
