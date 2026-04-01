/**
 * Winners service
 *
 * Creates and retrieves auction winner records when auctions end.
 * No payment or money logic — winners are recorded for contact-flow purposes only.
 *
 * Planned functions:
 *   createWinner(auctionId, winnerId, finalPrice)
 *     - called by the auction expiry cron after status flips to 'ended'
 *     - inserts a row into auction_winners
 *
 *   getWinner(auctionId)
 *   getUserWins(userId, cursor?)
 */

export {};
