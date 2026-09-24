import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@ecomkit/database";
import type { MatchingStatus, Prisma } from "@ecomkit/database";
import type { ResultQueryDto } from "./dto/result-query.dto.js";

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

  async findResults(id: string, query: ResultQueryDto) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const allowedStatuses: MatchingStatus[] = ["MATCHED", "PDF_NOT_FOUND", "EXCEL_NOT_FOUND", "DUPLICATE", "PARSE_ERROR"];
    if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(pageSize)) {
      throw new BadRequestException({ errorCode: "RESULT_QUERY_INVALID", message: "page must be positive and pageSize must be 20, 50, or 100." });
    }
    if (query.status && !allowedStatuses.includes(query.status as MatchingStatus)) {
      throw new BadRequestException({ errorCode: "RESULT_QUERY_INVALID", message: "status is not a supported matching status." });
    }
    if (query.group && !["success", "warning", "error"].includes(query.group)) {
      throw new BadRequestException({ errorCode: "RESULT_QUERY_INVALID", message: "group must be success, warning, or error." });
    }
    const groupStatuses: Record<NonNullable<ResultQueryDto["group"]>, MatchingStatus[]> = {
      success: ["MATCHED"],
      warning: ["PDF_NOT_FOUND", "EXCEL_NOT_FOUND"],
      error: ["DUPLICATE", "PARSE_ERROR"]
    };
    const where: Prisma.OrderWhereInput = {
      batchId: id,
      ...(query.status ? { matchingStatus: query.status as MatchingStatus } : query.group ? { matchingStatus: { in: groupStatuses[query.group] } } : {})
    };

    const batch = await prisma.batch.findUnique({
      where: { id },
      select: {
        id: true,
        processingStatus: true,
        fileCount: true,
        successCount: true,
        warningCount: true,
        errorCount: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!batch) {
      throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
    }

    const [totalOrders, filteredTotal, matchingGroups, orders] = await Promise.all([
      prisma.order.count({ where: { batchId: id } }),
      prisma.order.count({ where }),
      prisma.order.groupBy({ where: { batchId: id }, by: ["matchingStatus"], _count: { _all: true }, orderBy: { matchingStatus: "asc" } }),
      prisma.order.findMany({
        where,
        orderBy: [{ normalizedOrderCode: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          rawOrderCode: true,
          normalizedOrderCode: true,
          platform: true,
          matchingStatus: true,
          sourceRefs: true
        }
      })
    ]);

    const counts = new Map(matchingGroups.map(group => [group.matchingStatus, group._count._all]));
    return {
      batch: {
        id: batch.id,
        processingStatus: batch.processingStatus,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt
      },
      summary: {
        totalFiles: batch.fileCount,
        totalOrders,
        success: batch.successCount,
        warning: batch.warningCount,
        error: batch.errorCount
      },
      matching: {
        matched: counts.get("MATCHED") ?? 0,
        pdfNotFound: counts.get("PDF_NOT_FOUND") ?? 0,
        excelNotFound: counts.get("EXCEL_NOT_FOUND") ?? 0,
        duplicate: counts.get("DUPLICATE") ?? 0,
        parseError: counts.get("PARSE_ERROR") ?? 0
      },
      pagination: {
        page,
        pageSize,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / pageSize)
      },
      orders
    };
  }
}
