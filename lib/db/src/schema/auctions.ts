import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Storage path conventions ─────────────────────────────────────────────────
// Bucket:  auction-media  (private, service_role only)
// Video:   auctions/{auctionId}/video.{ext}
// Images:  auctions/{auctionId}/images/{index}.{ext}
// ─────────────────────────────────────────────────────────────────────────────

export const auctionsTable = pgTable("auctions", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Ownership
  sellerId: uuid("seller_id").notNull(),

  // Listing info
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull(), // "video" | "album"

  // Supabase Storage paths (relative to the bucket root)
  storagePath:  text("storage_path"),          // primary video file path
  imagePaths:   text("image_paths").array(),    // ordered album image paths

  // Bidding
  startingBid:  integer("starting_bid").notNull().default(0),   // in cents
  currentBid:   integer("current_bid").notNull().default(0),    // in cents
  minIncrement: integer("min_increment").notNull().default(1000), // in cents (default $10)
  bidCount:     integer("bid_count").notNull().default(0),

  // Timing
  startsAt:   timestamp("starts_at", { withTimezone: true }),
  endsAt:     timestamp("ends_at", { withTimezone: true }).notNull(),

  // ── Media lifecycle ────────────────────────────────────────────────────────
  // expiresAt = endsAt + MEDIA_RETENTION_DAYS (default 7 days).
  // Set by the application at auction-creation time, never by a trigger,
  // so it is always readable and auditable without PG functions.
  expiresAt:        timestamp("expires_at",         { withTimezone: true }).notNull(),
  mediaDeletedAt:   timestamp("media_deleted_at",   { withTimezone: true }),   // null = files still live
  videosDeletedAt:  timestamp("videos_deleted_at",  { withTimezone: true }),   // phase-1 done
  imagesDeletedAt:  timestamp("images_deleted_at",  { withTimezone: true }),   // phase-2 done

  // Soft-delete if needed in the future
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const insertAuctionSchema = createInsertSchema(auctionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  mediaDeletedAt: true,
  videosDeletedAt: true,
  imagesDeletedAt: true,
  deletedAt: true,
});

export const selectAuctionSchema = createSelectSchema(auctionsTable);

export type InsertAuction = z.infer<typeof insertAuctionSchema>;
export type Auction = typeof auctionsTable.$inferSelect;
