import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/billing/verify", (req, res) => {
  const { userId, purchaseToken, productId } = req.body as {
    userId: string;
    purchaseToken: string;
    productId: string;
  };

  logger.info(
    { userId, productId, hasPurchaseToken: Boolean(purchaseToken) },
    "billing/verify called — verification not implemented",
  );

  res.status(501).json({
    success: false,
    error: "BILLING_VERIFICATION_NOT_IMPLEMENTED",
    message: "Google Play billing verification is not implemented yet",
  });
});

export default router;
