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
import ratingsRouter from "./ratings";
import whatsappRouter from "./whatsapp";
import billingRouter from "./billing";
import secureDealsRouter from "./secure-deals";
import dealConditionsRouter from "./deal-conditions";
import sellerConditionsRouter from "./seller-conditions";
import dealRatingsRouter from "./deal-ratings";
import paymentProofRouter from "./payment-proof";

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
// paymentProofRouter must be registered BEFORE adminRouter because it defines
// GET /admin/payment-proofs — if adminRouter is checked first it would intercept
// all /admin/* paths and return 404 before this route is ever reached.
router.use(paymentProofRouter);
router.use("/admin", adminRouter);
router.use(auctionRouter);
router.use(billingRouter);
// secureDealsRouter and dealConditionsRouter must be registered BEFORE
// notificationRouter, because notificationRouter applies a router-level
// requireAuth that intercepts every subsequent /api/* request.
router.use(secureDealsRouter);
router.use(dealConditionsRouter);
router.use(sellerConditionsRouter);
router.use(dealRatingsRouter);
router.use(notificationRouter);
router.use(reportsRouter);
router.use(viewsRouter);
router.use(dealsRouter);
router.use(ratingsRouter);

export default router;
