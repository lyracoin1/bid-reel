import app from "./app";
import { logger } from "./lib/logger";
import { startMediaCleanupScheduler } from "./lib/media-lifecycle";
import { startProfileCleanupScheduler } from "./lib/profile-cleanup";
import { startPurchaseDeadlineScheduler } from "./lib/purchase-deadline";
import { supabaseAdmin } from "./lib/supabase";

/**
 * One-time data fix (migration 040): reset every auction whose min_increment
 * is still 10 (the old server-side Zod default) back to 1.
 *
 * No seller UI has ever exposed the min_increment field, so any row with
 * min_increment = 10 carries the old automatic default — not an intentional
 * seller preference. Running this at startup is safe and idempotent: once all
 * rows are updated the WHERE clause matches nothing and the call is a no-op.
 */
async function resetOldMinIncrements(): Promise<void> {
  const { error, count } = await supabaseAdmin
    .from("auctions")
    .update({ min_increment: 1 }, { count: "exact" })
    .eq("min_increment", 10);

  if (error) {
    logger.error({ err: error }, "resetOldMinIncrements: update failed");
  } else {
    logger.info({ rowsUpdated: count ?? 0 }, "resetOldMinIncrements: done");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  resetOldMinIncrements().catch(err =>
    logger.error({ err: String(err) }, "resetOldMinIncrements: unexpected error"),
  );
  startMediaCleanupScheduler();
  startProfileCleanupScheduler();
  startPurchaseDeadlineScheduler();
});
