import nodemailer from "nodemailer";
import config from "../config";

export const transporter = nodemailer.createTransport({
	host: "smtp.gmail.com",
	port: 465,
	secure: true,
	auth: {
		user: config.smtp_user,
		pass: config.smtp_password,
	},
});
