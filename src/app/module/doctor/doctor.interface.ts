import { DoctorVerificationStatus } from "../../../generated/prisma/enums";

export interface IApplyAsDoctorPayload {
	user: {
		name: string;
		email: string;
	};
	doctor: {
		address?: string;
		specialization: string;
		licenseNumber: string;
		qualifications: string;
		experienceYears: number;
		bio?: string;
		consultationFee?: number;
		contactNumber?: string;
	};
}

export interface IVerifyDoctorEmailPayload {
	email: string;
	otp: string;
}

export interface IApproveDoctorPayload {
	doctorId: string;
	verificationStatus: DoctorVerificationStatus;
	rejectionReason: string;
}
