/**
 * Blocks controller
 *
 * Planned routes:
 *   POST   /api/blocks          — block a user
 *   DELETE /api/blocks/:userId  — unblock a user
 *   GET    /api/blocks          — list blocked users (current user)
 *
 * Rules:
 *   - a user cannot block themselves
 *   - blocked users' auctions are excluded from the caller's feed
 */

export {};
