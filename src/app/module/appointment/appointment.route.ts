import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AppointmentController } from "./appointment.controller";

const router = Router();

router.post(
	"/book-appointment",
	auth(Role.PATIENT),
	AppointmentController.bookAppointment,
);

//book appointment callback url
router.get(
	"/book-appointment/payment/callback",
	AppointmentController.bookAppointmentCallback,
);

export const AppointmentRoutes = router;
