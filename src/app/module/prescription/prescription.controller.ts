import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PrescriptionServices } from "./prescription.service";

const createPrescription = catchAsync(async (req: Request, res: Response) => {
    const payload = req.body;
    const user = req.user!;

    const result = await PrescriptionServices.createPrescription(payload, user);
    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: "Prescription Created And Emailed To Patient Successfully",
        data: result,
    });
});

const getSinglePrescription = catchAsync(async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const user = req.user!;

    const result = await PrescriptionServices.getSinglePrescription(
        appointmentId,
        user,
    );
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Prescription Retrieved Successfully",
        data: result,
    });
});

export const PrescriptionController = {
    createPrescription,
    getSinglePrescription,
};