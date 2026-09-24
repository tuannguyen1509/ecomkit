import { BadRequestException } from "@nestjs/common";

export interface UploadErrorDetail {
  errorCode: "FILE_INVALID" | "FILE_EMPTY" | "FILE_CORRUPTED";
  message: string;
  details: { filename?: string; field: "files" };
}

export function uploadError(detail: UploadErrorDetail): BadRequestException {
  return new BadRequestException(detail);
}

export function uploadErrors(details: UploadErrorDetail[]): BadRequestException {
  return new BadRequestException({ errors: details });
}
