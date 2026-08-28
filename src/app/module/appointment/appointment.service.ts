import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";

const bookAppointment = async () => {
	const tranjectionResult = await prisma.$transaction(async (tx) => {
		const bkashIdToken = await getBkashIdToken();

		if (!bkashIdToken) {
			throw new Error("No Bkash Access Token Found!");
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
					payerReference: "01723888888",
					callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
					amount: "1200",
					currency: "BDT",
					intent: "sale",
					merchantInvoiceNumber: "Inv4", // appointment id
				}),
			},
		);
		const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();
		return bkashCreatePaymentResult;
	});
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
	const { paymentID: paymentId, status } = query;

	if (!status) {
		throw new Error("Payment Status is Missing");
	}

	if (!paymentId) {
		throw new Error("Payment Id Missing");
	}

	const bkashIdToken = await getBkashIdToken();

	if (!bkashIdToken) {
		throw new Error("No Bkash Access Token Found!");
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
		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
		};
	}
	if (status === "failure") {
		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=failure`,
		};
	}
	if (status === "cancel") {
		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
		};
	}

	return {
		executedPaymentResult,
		redirectUrl: `${config.frontend_url}/dashboard/my-appointments`,
	};
};

export const AppointmentServices = {
	bookAppointment,
	bookAppointmentCallback,
};
