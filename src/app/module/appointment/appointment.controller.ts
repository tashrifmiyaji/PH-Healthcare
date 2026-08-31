import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppointmentServices } from "./appointment.service";

const bookAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;
	const result = await AppointmentServices.bookAppointment(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointment created successfully.",
		data: result,
	});
});

const bookAppointmentCallback = catchAsync(
	async (req: Request, res: Response) => {
		const query = req.query;
		const { redirectUrl } =
			await AppointmentServices.bookAppointmentCallback(query);

		res.redirect(redirectUrl);
	},
);

export const AppointmentController = {
	bookAppointment,
	bookAppointmentCallback,
};
