import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { auctionsTable } from "./auctions";

export const bidsTable = pgTable("bids", {
  id: uuid("id").primaryKey().defaultRandom(),

  auctionId: uuid("auction_id")
    .notNull()
    .references(() => auctionsTable.id, { onDelete: "cascade" }),

  userId: uuid("user_id").notNull(),

  /** Amount in cents (e.g. 250000 = $2,500.00) */
  amount: integer("amount").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertBidSchema = createInsertSchema(bidsTable).omit({
  id: true,
  createdAt: true,
});

export const selectBidSchema = createSelectSchema(bidsTable);

export type InsertBid = z.infer<typeof insertBidSchema>;
export type Bid = typeof bidsTable.$inferSelect;
