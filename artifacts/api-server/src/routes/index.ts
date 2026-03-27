import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import auctionRouter from "./auctions";
import notificationRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/admin", adminRouter);
router.use(auctionRouter);
router.use(notificationRouter);

export default router;
