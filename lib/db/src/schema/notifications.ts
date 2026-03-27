import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Notification types:
 *   outbid          — someone outbid the current user on an auction they bid on
 *   auction_started — an auction they watched (bell) has gone live
 *   auction_won     — they won a completed auction
 *   new_bid         — (seller view) someone placed a bid on their listing
 */
export const NOTIFICATION_TYPES = ["outbid", "auction_started", "auction_won", "new_bid"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** The user this notification is delivered to */
  userId: uuid("user_id").notNull(),

  /** Discriminator for icon/colour in the UI */
  type: text("type").$type<NotificationType>().notNull(),

  /** Human-readable notification body */
  message: text("message").notNull(),

  /** Optional deep-link — e.g. the auction page this notification is about */
  auctionId: uuid("auction_id"),

  /** False until the user opens the notification panel */
  read: boolean("read").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
});

export const selectNotificationSchema = createSelectSchema(notificationsTable);

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
