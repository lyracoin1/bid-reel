/**
 * GET /version
 *
 * Public endpoint — no auth required.
 *
 * Returns version metadata used by the Capacitor Android app on startup to
 * decide whether to prompt the user for an update.
 *
 * Logic in the client:
 *   mandatory update  →  updateRequired === true
 *                        OR installedCode < minVersionCode
 *   optional update   →  installedCode < latestVersionCode  (and not mandatory)
 *   no prompt         →  installedCode >= latestVersionCode
 *
 * Configuration (all env vars are optional):
 *
 *   MIN_APP_VERSION_CODE      — integer: oldest build still allowed to run.
 *                               Default: 1 (no mandatory update ever forced).
 *                               Bump to the new versionCode to force all older
 *                               builds to update before they can enter the app.
 *
 *   LATEST_APP_VERSION_CODE   — integer: newest released build.
 *                               Default: CURRENT_VERSION_CODE (55).
 *                               When this is higher than a user's installed
 *                               versionCode they see the optional-update prompt.
 *
 *   APP_UPDATE_REQUIRED       — "true" | "false" (default "false").
 *                               When "true", ALL users are forced to update
 *                               regardless of their versionCode.
 */

import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PACKAGE_NAME        = "com.bidreel.android";
const CURRENT_VERSION_CODE = 55;
const PLAY_STORE_URL      = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`;

const DEFAULT_MIN_VERSION_CODE = 1;

const DEFAULT_MESSAGE_EN =
  "A new version of BidReel is available. Update now for the best experience.";
const DEFAULT_MESSAGE_AR =
  "يتوفر إصدار جديد من BidReel. حدّث التطبيق الآن للحصول على أفضل تجربة.";

router.get("/version", (_req, res) => {
  // ── Minimum supported version ─────────────────────────────────────────────
  const rawMin      = process.env["MIN_APP_VERSION_CODE"];
  const parsedMin   = rawMin ? parseInt(rawMin, 10) : NaN;
  const minVersionCode =
    !isNaN(parsedMin) && parsedMin >= 0 ? parsedMin : DEFAULT_MIN_VERSION_CODE;

  if (rawMin && isNaN(parsedMin)) {
    logger.warn({ rawMin }, "version: MIN_APP_VERSION_CODE is invalid — using default");
  }

  // ── Latest released version ───────────────────────────────────────────────
  const rawLatest    = process.env["LATEST_APP_VERSION_CODE"];
  const parsedLatest = rawLatest ? parseInt(rawLatest, 10) : NaN;
  const latestVersionCode =
    !isNaN(parsedLatest) && parsedLatest >= 0 ? parsedLatest : CURRENT_VERSION_CODE;

  if (rawLatest && isNaN(parsedLatest)) {
    logger.warn({ rawLatest }, "version: LATEST_APP_VERSION_CODE is invalid — using current");
  }

  // ── Force-update flag ─────────────────────────────────────────────────────
  const updateRequired = process.env["APP_UPDATE_REQUIRED"] === "true";

  return res.json({
    // Mandatory gate: client must be >= this or the app is blocked.
    minVersionCode,
    // Optional prompt: client sees "update available" if installed < this.
    latestVersionCode,
    // Convenience: the versionCode of the current production build.
    // Kept for backward compatibility — equal to latestVersionCode by default.
    currentVersionCode: CURRENT_VERSION_CODE,
    // When true, ALL clients are blocked regardless of versionCode.
    updateRequired,
    // Bilingual update messages shown in the prompt.
    updateMessageEn: DEFAULT_MESSAGE_EN,
    updateMessageAr: DEFAULT_MESSAGE_AR,
    playStoreUrl: PLAY_STORE_URL,
  });
});

export default router;
