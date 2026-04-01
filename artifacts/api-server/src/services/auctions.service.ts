/**
 * Auctions service
 *
 * Encapsulates all database access for the auctions domain.
 * Controllers call these functions; nothing else talks to Supabase directly
 * for auction data.
 *
 * Planned functions:
 *   listActiveAuctions(cursor?, excludeUserIds?)
 *   getAuctionById(id)
 *   createAuction(sellerId, data)
 *   expireAuctions()           — cron: flip status to 'ended', create winner record
 */

export {};
