/**
 * Winners service
 *
 * Winner assignment is handled inline in auction-lifecycle.ts (expireAuctions)
 * and in the bid placement routes (winner_id / winner_bid_id written on each bid).
 *
 * Planned Phase 2 additions:
 *   getWinner(auctionId)   — retrieve winner + final price for a given auction
 *   getUserWins(userId)    — list of auctions a user has won
 *
 * No payment or money logic — winners are recorded for contact-flow purposes only.
 */

export {};
