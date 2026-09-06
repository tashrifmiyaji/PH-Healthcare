import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AppointmentController } from "./appointment.controller";
import { BookAppointmentValidationZodSchema, UpdateAppointmentStatusValidationZodSchema } from "./appointment.validation";

const router = Router();

router.post(
	"/book-appointment",
	auth(Role.PATIENT),
	validateRequest(BookAppointmentValidationZodSchema),
	AppointmentController.bookAppointment,
);
router.post(
	"/pay-appointment",
	auth(Role.PATIENT),
	AppointmentController.payAppointment,
);
router.post(
	"/cancel-appointment",
	auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
	AppointmentController.cancelAppointment,
);

//book appointment callback url
router.get(
	"/book-appointment/payment/callback",
	AppointmentController.bookAppointmentCallback,
);

router.patch(
	"/update-status/:appointmentId",
	auth(Role.DOCTOR),
	validateRequest(UpdateAppointmentStatusValidationZodSchema),
	AppointmentController.updateAppointmentStatus,
);

router.get(
	"/my-appointments",
	auth(Role.PATIENT),
	AppointmentController.getMyAppointments,
);

router.get(
	"/doctor-appointments",
	auth(Role.DOCTOR),
	AppointmentController.getDoctorAppointments,
);

router.get(
	"/all-appointments",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AppointmentController.getAllAppointments,
);

router.get(
	"/:appointmentId",
	auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
	AppointmentController.getSingleAppointment,
);


export const AppointmentRoutes = router;
