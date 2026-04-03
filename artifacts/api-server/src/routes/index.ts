import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import followsRouter from "./follows";
import savesRouter from "./saves";
import mediaRouter from "./media";
import adminRouter from "./admin";
import auctionRouter from "./auctions";
import notificationRouter from "./notifications";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(followsRouter);
router.use(savesRouter);
router.use(mediaRouter);
router.use("/admin", adminRouter);
router.use(auctionRouter);
router.use(notificationRouter);
router.use(reportsRouter);

export default router;
