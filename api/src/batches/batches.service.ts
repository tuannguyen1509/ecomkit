import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@ecomkit/database";
import type { MatchingStatus, Prisma, ProcessingStatus } from "@ecomkit/database";
import type { ResultQueryDto } from "./dto/result-query.dto.js";
import type { ErrorQueryDto } from "./dto/error-query.dto.js";
import type { HistoryQueryDto } from "./dto/history-query.dto.js";

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

  async findHistory(query: HistoryQueryDto) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const statuses: ProcessingStatus[] = ["PENDING", "PROCESSING", "SUCCESS", "WARNING", "ERROR"];
    if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(pageSize) || (query.status && !statuses.includes(query.status as ProcessingStatus))) {
      throw new BadRequestException({ errorCode: "HISTORY_QUERY_INVALID", message: "page must be positive, pageSize must be 20, 50, or 100, and status must be supported." });
    }
    const where: Prisma.BatchWhereInput = query.status ? { processingStatus: query.status as ProcessingStatus } : {};
    const [total, batches] = await Promise.all([
      prisma.batch.count({ where }),
      prisma.batch.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, createdAt: true, updatedAt: true, processingStatus: true, fileCount: true, excelFileCount: true, pdfFileCount: true, orderCount: true } })
    ]);
    const ids = batches.map((batch) => batch.id);
    const [matchGroups, errorGroups] = ids.length ? await Promise.all([
      prisma.order.groupBy({ where: { batchId: { in: ids } }, by: ["batchId", "matchingStatus"], _count: { _all: true } }),
      prisma.processingError.groupBy({ where: { batchId: { in: ids } }, by: ["batchId", "severity"], _count: { _all: true } })
    ]) : [[], []] as const;
    const matched = new Map<string, number>();
    for (const group of matchGroups) if (group.matchingStatus === "MATCHED") matched.set(group.batchId, group._count._all);
    const warnings = new Map<string, number>(), errors = new Map<string, number>();
    for (const group of errorGroups) {
      if (group.severity === "WARNING") warnings.set(group.batchId, group._count._all);
      if (group.severity === "ERROR") errors.set(group.batchId, group._count._all);
    }
    return {
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      items: batches.map((batch) => ({ ...batch, matchedCount: matched.get(batch.id) ?? 0, warningCount: warnings.get(batch.id) ?? 0, errorCount: errors.get(batch.id) ?? 0 }))
    };
  }

  async findErrors(batchId: string, query: ErrorQueryDto) {
    const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20);
    if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(pageSize)) throw new BadRequestException({ errorCode: "ERROR_QUERY_INVALID", message: "page must be positive and pageSize must be 20, 50, or 100." });
    if (query.severity && !["SUCCESS", "WARNING", "ERROR"].includes(query.severity)) throw new BadRequestException({ errorCode: "ERROR_QUERY_INVALID", message: "severity is not supported." });
    if (query.errorCode && (query.errorCode.length > 100 || !/^[A-Z0-9_]+$/.test(query.errorCode))) throw new BadRequestException({ errorCode: "ERROR_QUERY_INVALID", message: "errorCode is invalid." });
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { id:true, processingStatus:true, createdAt:true } });
    if (!batch) throw new NotFoundException({ errorCode:"BATCH_NOT_FOUND", message:"Batch was not found." });
    const where: Prisma.ProcessingErrorWhereInput = { batchId, ...(query.severity ? { severity: query.severity as any } : {}), ...(query.errorCode ? { errorCode: query.errorCode } : {}), ...(query.uploadedFileId ? { uploadedFileId: query.uploadedFileId } : {}) };
    const [total, groups, items, files] = await Promise.all([
      prisma.processingError.count({ where }), prisma.processingError.groupBy({ where:{batchId}, by:["severity"], _count:{_all:true}, orderBy:{severity:"asc"} }),
      prisma.processingError.findMany({ where, orderBy:{createdAt:"desc"}, skip:(page-1)*pageSize, take:pageSize, select:{id:true,severity:true,errorCode:true,message:true,sheetName:true,pageNumber:true,rowNumber:true,columnName:true,fieldName:true,createdAt:true,uploadedFile:{select:{id:true,originalFilename:true,fileType:true,platform:true}}} }),
      prisma.uploadedFile.findMany({where:{batchId},select:{id:true,originalFilename:true,fileType:true}})
    ]);
    const counts=new Map(groups.map(g=>[g.severity,g._count._all]));
    return { batch, summary:{totalErrors:groups.reduce((n,g)=>n+g._count._all,0),warningCount:counts.get("WARNING")??0,errorCount:counts.get("ERROR")??0}, pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)}, files, items };
  }

  async findError(batchId:string,errorId:string) {
    const exists=await prisma.batch.findUnique({where:{id:batchId},select:{id:true}}); if(!exists) throw new NotFoundException({errorCode:"BATCH_NOT_FOUND",message:"Batch was not found."});
    const error=await prisma.processingError.findFirst({where:{id:errorId,batchId},include:{uploadedFile:{select:{id:true,originalFilename:true,fileType:true,platform:true}}}});
    if(!error) throw new NotFoundException({errorCode:"PROCESSING_ERROR_NOT_FOUND",message:"Processing error was not found in this Batch."});
    const context=error.rawContext && typeof error.rawContext==="object" ? JSON.parse(JSON.stringify(error.rawContext),(_k,v)=>typeof v==="string"&&(/(?:[A-Z]:\\|\/app\/storage|postgresql:\/\/|password|token)/i.test(v))?"[redacted]":v) : error.rawContext;
    return {...error,rawContext:context};
  }
}
