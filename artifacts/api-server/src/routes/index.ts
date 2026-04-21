import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import passwordResetRouter from "./password-reset";
import usersRouter from "./users";
import followsRouter from "./follows";
import savesRouter from "./saves";
import likesRouter from "./likes";
import mediaRouter from "./media";
import adminRouter from "./admin";
import auctionRouter from "./auctions";
import notificationRouter from "./notifications";
import reportsRouter from "./reports";
import viewsRouter from "./views";
import dealsRouter from "./deals";
import whatsappRouter from "./whatsapp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(passwordResetRouter);
// whatsappRouter must be registered BEFORE notificationRouter, because
// notificationRouter applies a router-level requireAuth that would
// otherwise intercept every subsequent /api/* request.
router.use(whatsappRouter);
router.use(usersRouter);
router.use(followsRouter);
router.use(savesRouter);
router.use(likesRouter);
router.use(mediaRouter);
router.use("/admin", adminRouter);
router.use(auctionRouter);
router.use(notificationRouter);
router.use(reportsRouter);
router.use(viewsRouter);
router.use(dealsRouter);

export default router;
