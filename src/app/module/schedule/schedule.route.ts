import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ScheduleController } from "./schedule.controller";
import {
    CreateScheduleValidationZodSchema,
    UpdateScheduleValidationZodSchema,
} from "./schedule.validation";

const router = Router();

router.post(
    "/create-schedule",
    auth(Role.DOCTOR),
    validateRequest(CreateScheduleValidationZodSchema),
    ScheduleController.createSchedule,
);

router.get(
    "/my-schedules",
    auth(Role.DOCTOR),
    ScheduleController.getMySchedules,
);

router.get(
    "/all-schedules",
    auth(Role.ADMIN, Role.SUPER_ADMIN),
    ScheduleController.getAllSchedules,
);

router.get("/todays-schedule", ScheduleController.getTodaysSchedules);

router.patch(
    "/update-schedule/:scheduleId",
    auth(Role.DOCTOR),
    validateRequest(UpdateScheduleValidationZodSchema),
    ScheduleController.updateSchedule,
);

router.patch(
    "/publish-schedule/:scheduleId",
    auth(Role.DOCTOR),
    ScheduleController.publishSchedule,
);

router.get(
    "/:scheduleId",
    auth(Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
    ScheduleController.getScheduleById,
);

router.delete(
    "/:scheduleId",
    auth(Role.DOCTOR),
    ScheduleController.deleteSchedule,
);

export const ScheduleRoutes = router;