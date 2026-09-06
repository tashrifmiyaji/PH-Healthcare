import httpStatus from "http-status";
import {
	AppointmentStatus,
	PaymentStatus,
	Role,
	ScheduleStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import * as dateFns from "date-fns";
import { transporter } from "../../lib/nodemailer";
import PDFDocument from "pdfkit";
import {
	IBookAppointmentPayload,
	ICancelAppointmentPayload,
	IPayAppointmentPayload,
	IUpdateAppointmentStatusPayload,
} from "./appointment.interface";
import { AppointmentWhereInput } from "../../../generated/prisma/models";
import { IQuery } from "../../interfaces";

const bookAppointment = async (
	payload: IBookAppointmentPayload,
	user: RequestUser,
) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const patient = await prisma.patient.findUnique({
			where: { userId: user.userId },
		});

		if (!patient) {
			throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
		}

		const schedule = await prisma.schedule.findUnique({
			where: { id: payload.scheduleId },
			include: { doctor: true },
		});

		if (!schedule || schedule.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
		}

		if (schedule.status !== ScheduleStatus.PUBLISHED) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Is Not Published Yet",
			);
		}

		const now = new Date();

		if (!dateFns.isSameDay(now, schedule.startDateTime)) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Is Not Available Today",
			);
		}

		if (!dateFns.isBefore(now, schedule.startDateTime)) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Has Already Started",
			);
		}

		if (!schedule.doctor.consultationFee) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Doctor Has Not Set A Consultation Fee Yet",
			);
		}

		const amount = schedule.doctor.consultationFee.toString();

		const appointment = await tx.appointment.create({
			data: {
				status: AppointmentStatus.PENDING,
				patientId: patient.id,
				doctorId: schedule.doctor.id,
				scheduleId: schedule.id,
			},
		});

		const bkashIdToken = await getBkashIdToken();

		if (!bkashIdToken) {
			throw new AppError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"No Bkash Access Token Found!",
			);
		}

		const bkashCreatePaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/create`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					authorization: bkashIdToken,
					"x-app-key": config.bkash_app_key,
				},
				body: JSON.stringify({
					mode: "0011",
					payerReference: user.email,
					callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
					amount: amount,
					currency: "BDT",
					intent: "sale",
					merchantInvoiceNumber: appointment.id,
				}),
			},
		);
		const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

		await tx.payment.create({
			data: {
				merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
				appointmentId: appointment.id,
				amount: "1200",
				gatewayResponse: bkashCreatePaymentResult,
				bkashPaymentId: bkashCreatePaymentResult.paymentID,
				payerReference: user.email,
			},
		});

		return {
			paymentUrl: bkashCreatePaymentResult.bkashURL,
		};
	});

	return transactionResult;
};

const payAppointment = async (
	payload: IPayAppointmentPayload,
	user: RequestUser,
) => {
	const appointmentId = payload.appointmentId;

	const existingAppointment = await prisma.appointment.findUnique({
		where: {
			id: appointmentId,
		},
		include: {
			schedule: {
				include: { doctor: true },
			},
		},
	});

	if (!existingAppointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Does Not Exists");
	}

	if (
		existingAppointment.status === "CANCELLED" ||
		existingAppointment.status === "ONGOING" ||
		existingAppointment.status === "COMPLETED"
	) {
		const appointmentStatus = existingAppointment.status;
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Appointment is already ${appointmentStatus.toLowerCase()}`,
		);
	}

	if (!existingAppointment.schedule.doctor.consultationFee) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Doctor Has Not Set A Consultation Fee Yet",
		);
	}

	const amount = existingAppointment.schedule.doctor.consultationFee.toString();

	const bkashIdToken = await getBkashIdToken();

	if (!bkashIdToken) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"No Bkash Access Token Found!",
		);
	}

	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},
			body: JSON.stringify({
				mode: "0011",
				payerReference: user.email,
				callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
				amount: amount,
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber: existingAppointment.id,
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

	await prisma.payment.update({
		where: {
			appointmentId: existingAppointment.id,
		},
		data: {
			merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
			gatewayResponse: bkashCreatePaymentResult,
			bkashPaymentId: bkashCreatePaymentResult.paymentID,
		},
	});

	return {
		paymentUrl: bkashCreatePaymentResult.bkashURL,
	};
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const { paymentID: paymentId, status } = query;

		if (!status) {
			throw new AppError(httpStatus.BAD_REQUEST, "Payment Status is Missing");
		}

		if (!paymentId) {
			throw new AppError(httpStatus.BAD_REQUEST, "Payment Id Missing");
		}

		const bkashIdToken = await getBkashIdToken();

		if (!bkashIdToken) {
			throw new AppError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"No Bkash Access Token Found!",
			);
		}

		const executedPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/execute`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-App-Key": config.bkash_app_key,
				},
				body: JSON.stringify({
					paymentID: paymentId,
				}),
			},
		);
		const executedPaymentResult = await executedPaymentResponse.json();

		if (status === "success") {
			const appointment = await prisma.appointment.findUnique({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				include: {
					schedule: true,
					patient: true,
					doctor: true,
				},
			});

			if (!appointment) {
				throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found!");
			}

			// total slot = 3 , available slot = 2
			// (total - available) + 1

			const alreadyBookedSlots =
				appointment.schedule.totalSlots - appointment.schedule.availableSlots;

			const serialNumber = alreadyBookedSlots + 1;

			// 25 August => 3:00 PM - 4:00 PM
			// 1st person joining time => startDateTime = 2026-08-25T15:00:00.436Z => 3:00 PM
			// serial number (1) - 1 * 20 => 0 minuets

			// 2nd person joining time => startDateTime = 2026-08-25T15:20:00.436Z => 3:00 PM
			// serial number (2) - 1 * 20 => 20 minutes

			// 3nd person joining time => startDateTime = 2026-08-25T15:40:00.436Z => 3:00 PM
			// serial number (3) - 1 * 20 => 40 minuets

			const joiningTime = dateFns.addMinutes(
				appointment.schedule.startDateTime,
				(serialNumber - 1) * 20,
			);

			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
					joiningTime,
					serialNumber,
				},
			});

			const newAvailableSlots = appointment.schedule.availableSlots - 1;

			await prisma.schedule.update({
				where: {
					id: appointment.schedule.id,
				},
				data: {
					availableSlots: newAvailableSlots,
				},
			});

			await tx.payment.update({
				where: {
					appointmentId: executedPaymentResult.merchantInvoiceNumber,
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.PAID,
					bkashTrxId: executedPaymentResult.trxID,
					paidAt: executedPaymentResult.paymentExecuteTime,
					gatewayResponse: executedPaymentResult,
				},
			});
			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
				},
			});
			await tx.payment.update({
				where: {
					appointmentId: executedPaymentResult.merchantInvoiceNumber,
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.PAID,
					bkashTrxId: executedPaymentResult.trxID,
					paidAt: executedPaymentResult.paymentExecuteTime,
					gatewayResponse: executedPaymentResult,
				},
			});

			const pdfDocument = new PDFDocument({ margin: 50 });

			const pdfChunks: Buffer[] = [];

			pdfDocument.on("data", (chunk: Buffer) => {
				pdfChunks.push(chunk);
			});

			const pdfReadyPromise = new Promise<Buffer>((resolve) => {
				pdfDocument.on("end", () => {
					resolve(Buffer.concat(pdfChunks));
				});
			});

			pdfDocument
				.fontSize(20)
				.text("PH Healthcare System", { align: "center" });
			pdfDocument.fontSize(14).text("Appointment Invoice", { align: "center" });
			pdfDocument.moveDown(2);

			pdfDocument
				.fontSize(12)
				.text(`Patient Name: ${appointment.patient?.name}`);
			pdfDocument.text(`Patient Email: ${appointment.patient?.email}`);
			pdfDocument.moveDown();

			pdfDocument.text(`Doctor Name: ${appointment.doctor?.name}`);
			pdfDocument.text(`Specialization: ${appointment.doctor?.specialization}`);
			pdfDocument.moveDown();

			pdfDocument.text(
				`Appointment Date: ${appointment.schedule.startDateTime.toDateString()}`,
			);
			pdfDocument.text(`Your Joining Time: ${joiningTime.toString()}`);
			pdfDocument.text(`Your Serial Number: ${serialNumber}`);
			pdfDocument.text(`Meeting Link: ${appointment.schedule.meetingLink}`);
			pdfDocument.moveDown();

			pdfDocument.text(`Amount Paid: ${executedPaymentResult.amount} BDT`);
			pdfDocument.text(`Payment Method: bKash`);
			pdfDocument.text(`Transaction Id: ${executedPaymentResult.trxID}`);
			pdfDocument.text(`Paid At: ${executedPaymentResult.paymentExecuteTime}`);

			pdfDocument.end();

			const pdfBuffer = await pdfReadyPromise;

			await transporter.sendMail({
				from: config.email_sender,
				to: appointment.patient.email,
				subject: "Your Appointment Invoice - PH Healthcare System",
				text: "Thank you for booking an appointment. Please find your invoice attached.",
				attachments: [
					{
						filename: "invoice.pdf",
						content: pdfBuffer,
					},
				],
			});
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
			};
		} else if (status === "failure") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.FAILED,
					gatewayResponse: executedPaymentResult,
				},
			});

			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=failure`,
			};
		} else if (status === "cancel") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.CANCELLED,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
			};
		} else {
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments`,
			};
		}
	});

	return transactionResult;
};

const cancelAppointment = async (
	payload: ICancelAppointmentPayload,
	user: RequestUser,
) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const appointmentId = payload.appointmentId;

		const existingAppointment = await tx.appointment.findUnique({
			where: {
				id: appointmentId,
				patient: {
					email: user.email,
				},
			},
			include: {
				payment: true,
				schedule: true,
			},
		});

		if (!existingAppointment) {
			throw new AppError(httpStatus.NOT_FOUND, "Appointment Does Not Exists");
		}

		if (
			existingAppointment.status === "ONGOING" ||
			existingAppointment.status === "COMPLETED"
		) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Appointment Ongoing or Completed",
			);
		}

		if (existingAppointment.status === "CANCELLED") {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Appointment Already Cancelled",
			);
		}

		const updatedAppointment = await tx.appointment.update({
			where: {
				id: existingAppointment.id,
			},
			data: {
				status: AppointmentStatus.CANCELLED,
			},
		});

		await prisma.schedule.update({
			where: {
				id: existingAppointment.schedule.id,
			},
			data: {
				availableSlots: { increment: 1 },
			},
		});

		// refund process
		const now = new Date();
		const startDateTime = existingAppointment.schedule.startDateTime; // 25 August : 3:00 PM

		// After 2:00 Pm => no refund
		// must cancel before  2:00 PM
		const refundCutOffTime = dateFns.subHours(startDateTime, 1);

		// now >  refundCutOff Time => no refund
		// now < refundCutOff Time => refund eligible
		const isEligibleForRefund = dateFns.isBefore(now, refundCutOffTime);

		if (isEligibleForRefund) {
			const bkashIdToken = await getBkashIdToken();

			if (!bkashIdToken) {
				throw new AppError(
					httpStatus.BAD_GATEWAY,
					"No Bkash Access Token Found!",
				);
			}

			const bkashRefundPaymentResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/payment/refund`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						Authorization: bkashIdToken,
						"X-App-Key": config.bkash_app_key,
					},
					body: JSON.stringify({
						paymentID: existingAppointment.payment?.bkashPaymentId,
						trxID: existingAppointment.payment?.bkashTrxId,
						amount: existingAppointment.payment?.amount.toString(),
						sku: "Appointment Cancellation",
						reason: "Patient Cancelled The Appointment",
					}),
				},
			);

			const bkashRefundPaymentResult = await bkashRefundPaymentResponse.json();

			await tx.payment.update({
				where: {
					appointmentId: existingAppointment.id,
				},
				data: {
					refundTrxId: bkashRefundPaymentResult.refundTrxID,
					refundedAt: bkashRefundPaymentResult.completedTime,
					refundAmount: bkashRefundPaymentResult.amount,
					refundReason: "Patient Cancelled The Appointment",
					status: PaymentStatus.REFUNDED,
					gatewayResponse: bkashRefundPaymentResult,
				},
			});
		}

		const newPaymentInfo = await prisma.payment.findUnique({
			where: {
				appointmentId: existingAppointment.id,
			},
		});

		return {
			appointment: updatedAppointment,
			payment: newPaymentInfo,
		};
	});

	return transactionResult;
};

// DOCTOR ONLY CONFIRMED => ONGOING => COMPLETED
const updateAppointmentStatus = async (
	appointmentId: string,
	payload: IUpdateAppointmentStatusPayload,
	user: RequestUser,
) => {
	const doctor = await prisma.doctor.findUnique({
		where: { userId: user.userId },
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

	const appointment = await prisma.appointment.findUnique({
		where: { id: appointmentId, doctorId: doctor.id },
	});

	if (!appointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
	}

	if (appointment.status === AppointmentStatus.COMPLETED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Appointment is already completed",
		);
	}

	if (appointment.status === AppointmentStatus.CANCELLED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Appointment is already cancelled",
		);
	}
	if (appointment.status === AppointmentStatus.PENDING) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Appointment is Pending. You can change the status after appointment is confirmed",
		);
	}

	if (appointment.status === AppointmentStatus.CONFIRMED) {
		if (payload.status !== "ONGOING") {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Confirmed Appointment Must Be Ongoing At First",
			);
		}

		await prisma.appointment.update({
			where: {
				id: appointment.id,
			},
			data: {
				status: AppointmentStatus.ONGOING,
			},
		});
	}

	if (appointment.status === AppointmentStatus.ONGOING) {
		if (payload.status !== "COMPLETED") {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Ongoing Appointment Must Be Completed.",
			);
		}

		await prisma.appointment.update({
			where: {
				id: appointment.id,
			},
			data: {
				status: AppointmentStatus.COMPLETED,
			},
		});
	}

	const updatedAppointment = await prisma.appointment.findUnique({
		where: {
			id: appointment.id,
		},
	});

	return updatedAppointment;
};

//patient appointments
const getMyAppointments = async (query: IQuery, user: RequestUser) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const patient = await prisma.patient.findUnique({
		where: { userId: user.userId },
	});

	if (!patient) {
		throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
	}

	const andConditions: AppointmentWhereInput[] = [
		{
			patientId: patient.id,
		},
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			doctor: { select: { id: true, name: true, specialization: true } },
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

//doctor appointments
const getDoctorAppointments = async (query: IQuery, user: RequestUser) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const doctor = await prisma.doctor.findUnique({
		where: { userId: user.userId },
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

	const andConditions: AppointmentWhereInput[] = [
		{
			doctorId: doctor.id,
		},
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			patient: {
				select: { id: true, name: true, email: true, contactNumber: true },
			},
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

//admin super admin
const getAllAppointments = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: AppointmentWhereInput[] = [];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	if (query.doctorId) {
		andConditions.push({ doctorId: query.doctorId });
	}

	if (query.patientId) {
		andConditions.push({ patientId: query.patientId });
	}

	if (query.doctorEmail) {
		andConditions.push({
			doctor: {
				email: query.doctorEmail,
			},
		});
	}
	if (query.patientEmail) {
		andConditions.push({
			patient: {
				email: query.patientEmail,
			},
		});
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			patient: { select: { id: true, name: true, email: true } },
			doctor: { select: { id: true, name: true, specialization: true } },
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

// for all logged-in user
const getSingleAppointment = async (
	appointmentId: string,
	user: RequestUser,
) => {
	const appointment = await prisma.appointment.findUnique({
		where: { id: appointmentId },
		include: {
			patient: { select: { id: true, name: true, email: true, userId: true } },
			doctor: {
				select: { id: true, name: true, specialization: true, userId: true },
			},
			schedule: true,
			payment: true,
		},
	});

	if (!appointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
	}

	if (user.role === Role.PATIENT) {
		if (appointment.patient.userId !== user.userId) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Appointment",
			);
		}
	}
	if (user.role === Role.DOCTOR) {
		if (appointment.doctor.userId !== user.userId) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Appointment",
			);
		}
	}

	return appointment;
};

export const AppointmentServices = {
	bookAppointment,
	payAppointment,
	bookAppointmentCallback,
	cancelAppointment,
	updateAppointmentStatus,
	getMyAppointments,
	getDoctorAppointments,
	getAllAppointments,
	getSingleAppointment,
};
