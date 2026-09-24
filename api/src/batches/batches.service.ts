import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@ecomkit/database";

@Injectable()
export class BatchesService {
  async create(): Promise<{ id: string; processingStatus: string; createdAt: Date }> {
    return prisma.batch.create({
      data: { processingStatus: "PENDING" },
      select: { id: true, processingStatus: true, createdAt: true }
    });
  }

  async findOne(id: string): Promise<{
    id: string;
    processingStatus: string;
    fileCount: number;
    excelFileCount: number;
    pdfFileCount: number;
    orderCount: number;
    createdAt: Date;
    updatedAt: Date;
    files: Array<{
      id: string;
      originalFilename: string;
      sanitizedFilename: string;
      fileType: string;
      platform: string;
      mimeType: string | null;
      sizeBytes: number | null;
      processingStatus: string;
      createdAt: Date;
    }>;
  }> {
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        uploadedFiles: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            originalFilename: true,
            sanitizedFilename: true,
            fileType: true,
            platform: true,
            mimeType: true,
            sizeBytes: true,
            processingStatus: true,
            createdAt: true
          }
        }
      }
    });

    if (!batch) {
      throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
    }

    return {
      id: batch.id,
      processingStatus: batch.processingStatus,
      fileCount: batch.fileCount,
      excelFileCount: batch.excelFileCount,
      pdfFileCount: batch.pdfFileCount,
      orderCount: batch.orderCount,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      files: batch.uploadedFiles.map((file) => ({
        ...file,
        sizeBytes: file.sizeBytes === null ? null : Number(file.sizeBytes)
      }))
    };
  }
}
