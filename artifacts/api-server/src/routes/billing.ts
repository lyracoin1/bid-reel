import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/billing/verify", (req, res) => {
  const { userId, purchaseToken, productId } = req.body as {
    userId: string;
    purchaseToken: string;
    productId: string;
  };

  logger.info({ userId, purchaseToken, productId }, "billing/verify received");

  res.json({ success: true });
});

export default router;
