import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AnalyticsController } from "./analytics.controller";

const router = Router();

router.get(
    "/patient-analytics",
    auth(Role.PATIENT),
    AnalyticsController.getPatientAnalytics,
);

router.get(
    "/doctor-analytics",
    auth(Role.DOCTOR),
    AnalyticsController.getDoctorAnalytics,
);

router.get(
    "/admin-analytics",
    auth(Role.ADMIN, Role.SUPER_ADMIN),
    AnalyticsController.getAdminAnalytics,
);

export const AnalyticsRoutes = router;