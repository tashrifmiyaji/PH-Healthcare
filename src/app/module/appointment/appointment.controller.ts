import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppointmentServices } from "./appointment.service";

const bookAppointment = catchAsync(async (req: Request, res: Response) => {
	const result = await AppointmentServices.bookAppointment();

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
		const { executedPaymentResult, redirectUrl } =
			await AppointmentServices.bookAppointmentCallback(query);
			
		console.log({ executedPaymentResult }, "callback controller");
		res.redirect(redirectUrl);
	},
);

export const AppointmentController = {
	bookAppointment,
	bookAppointmentCallback,
};
