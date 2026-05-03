/**
 * GET /version
 *
 * Public endpoint — no auth required.
 *
 * Returns the minimum Android versionCode the server considers acceptable.
 * The Capacitor splash screen reads this on startup and redirects users to
 * Google Play if their installed build is older than minVersionCode.
 *
 * Configuration:
 *   MIN_APP_VERSION_CODE — integer env var (optional).
 *     Default: current released versionCode (54).
 *     To force an update, bump this value to the new versionCode and
 *     set it in Replit Secrets / the hosting environment.
 */

import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PACKAGE_NAME = "com.bidreel.android";
const CURRENT_VERSION_CODE = 54;
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`;

router.get("/version", (_req, res) => {
  const raw = process.env["MIN_APP_VERSION_CODE"];
  const minVersionCode = raw ? parseInt(raw, 10) : CURRENT_VERSION_CODE;

  if (isNaN(minVersionCode) || minVersionCode < 0) {
    logger.warn(
      { raw },
      "version: MIN_APP_VERSION_CODE is invalid — falling back to current version",
    );
    return res.json({
      minVersionCode: CURRENT_VERSION_CODE,
      currentVersionCode: CURRENT_VERSION_CODE,
      playStoreUrl: PLAY_STORE_URL,
    });
  }

  return res.json({
    minVersionCode,
    currentVersionCode: CURRENT_VERSION_CODE,
    playStoreUrl: PLAY_STORE_URL,
  });
});

export default router;
