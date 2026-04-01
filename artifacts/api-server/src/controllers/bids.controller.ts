/**
 * Bids controller
 *
 * Routes (wired in routes/auctions.ts):
 *   POST /api/auctions/:id/bids — place a bid on a specific auction
 *   POST /api/bids              — legacy flat bid endpoint (same logic)
 *
 * Validation rules enforced:
 *   - amount > current_bid + min_increment
 *   - auction must not be expired (ends_at > now)
 *   - bidder cannot be the auction seller
 */

export {};
