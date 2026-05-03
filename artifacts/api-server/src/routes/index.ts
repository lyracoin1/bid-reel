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
import shipmentProofRouter from "./shipment-proof";
import confirmReceiptRouter from "./confirm-receipt";
import deliveryProofRouter from "./delivery-proof";
import shippingFeeDisputeRouter from "./shipping-fee-dispute";
import sellerPenaltyRouter from "./seller-penalty";
import adminDealsRouter from "./admin-deals";
import escrowRouter from "./escrow";
import externalPaymentWarningRouter from "./external-payment-warning";
import productMediaRouter from "./product-media";
import buyerInfoRouter from "./buyer-info";

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
// shipmentProofRouter + adminDealsRouter registered before adminRouter for the
// same reason as paymentProofRouter — they define /admin/* paths that would
// otherwise be swallowed by the /admin subrouter.
router.use(shipmentProofRouter);
router.use(confirmReceiptRouter);
router.use(deliveryProofRouter);
// shippingFeeDisputeRouter registered before adminRouter because it defines
// GET /api/admin/shipping-fee-disputes which would otherwise be swallowed.
router.use(shippingFeeDisputeRouter);
// sellerPenaltyRouter registered before adminRouter because it defines
// GET /api/admin/seller-penalties which would otherwise be swallowed.
router.use(sellerPenaltyRouter);
router.use(adminDealsRouter);
// escrowRouter must be registered BEFORE adminRouter (defines /admin/* paths)
// and BEFORE notificationRouter (which applies router-level requireAuth).
router.use(escrowRouter);
router.use(externalPaymentWarningRouter);
// productMediaRouter registered before adminRouter because it defines
// GET /admin/product-media which would otherwise be swallowed by /admin subrouter.
router.use(productMediaRouter);
router.use(buyerInfoRouter);
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
