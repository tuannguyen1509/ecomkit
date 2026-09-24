import { Catch, ExceptionFilter, ArgumentsHost, PayloadTooLargeException } from "@nestjs/common";
import { MulterError } from "multer";
import type { Response } from "express";

@Catch(MulterError, PayloadTooLargeException)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError | PayloadTooLargeException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isPayloadTooLarge = exception instanceof PayloadTooLargeException;
    const message = isPayloadTooLarge || (!isPayloadTooLarge && exception.code === "LIMIT_FILE_SIZE")
      ? "A file exceeds the configured upload size limit."
      : exception.code === "LIMIT_FILE_COUNT"
        ? "The request exceeds the configured file count limit."
        : "Invalid multipart upload request.";

    response.status(400).json({
      errorCode: "FILE_INVALID",
      message,
      details: { field: "files" }
    });
  }
}
