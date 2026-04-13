/**
 * Auctions service
 *
 * Auction lifecycle logic lives in lib/auction-lifecycle.ts.
 * Re-exported here so routes can import from either location.
 */

export { expireAuctions } from "../lib/auction-lifecycle";
