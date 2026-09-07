import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { PaymentController } from "./payment.controller";

const router = Router();

router.get("/my-payments", auth(Role.PATIENT), PaymentController.getMyPayments);

router.get(
    "/all-payments",
    auth(Role.ADMIN, Role.SUPER_ADMIN),
    PaymentController.getAllPayments,
);

router.get(
    "/:paymentId",
    auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
    PaymentController.getSinglePayment,
);

export const PaymentRoutes = router;