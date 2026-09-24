import "dotenv/config";
import { prisma } from "./client.js";

const marker = `STAGE2_TEST_${Date.now()}`;

async function main(): Promise<void> {
  const batch = await prisma.batch.create({
    data: {
      processingStatus: "PENDING",
      createdByUserId: null
    }
  });

  try {
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        batchId: batch.id,
        originalFilename: `${marker}.xlsx`,
        sanitizedFilename: `${marker}.xlsx`,
        fileType: "EXCEL",
        platform: "UNKNOWN",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: BigInt(128),
        processingStatus: "PENDING",
        rawData: { marker }
      }
    });

    const firstOrder = await prisma.order.create({
      data: {
        batchId: batch.id,
        rawOrderCode: `${marker}-RAW-1`,
        normalizedOrderCode: "2609178X85CBMY",
        platform: "SHOPEE",
        matchingStatus: "MATCHED",
        items: {
          create: [
            { productName: "Stage 2 item A", quantity: 2, price: "125.5000", sourcePlatform: "SHOPEE" },
            { productName: "Stage 2 item B", quantity: 1, price: "80.0000", sourcePlatform: "SHOPEE" }
          ]
        },
        processingLogs: {
          create: {
            batchId: batch.id,
            uploadedFileId: uploadedFile.id,
            level: "INFO",
            message: `${marker} log`,
            context: { marker }
          }
        },
        processingErrors: {
          create: {
            batchId: batch.id,
            uploadedFileId: uploadedFile.id,
            errorCode: "SYSTEM_ERROR",
            message: `${marker} error`,
            severity: "WARNING",
            cause: "UNKNOWN",
            rawContext: { marker }
          }
        }
      },
      include: { items: true, processingLogs: true, processingErrors: true }
    });

    const duplicateOrder = await prisma.order.create({
      data: {
        batchId: batch.id,
        rawOrderCode: `${marker}-RAW-2`,
        normalizedOrderCode: "2609178X85CBMY",
        platform: "SHOPEE",
        matchingStatus: "DUPLICATE"
      }
    });

    const nullableOrder = await prisma.order.create({
      data: {
        batchId: batch.id,
        rawOrderCode: `${marker}-NULLABLE`,
        normalizedOrderCode: `${marker}-NULLABLE`,
        platform: "UNKNOWN",
        matchingStatus: "PARSE_ERROR"
      }
    });

    const reloaded = await prisma.batch.findUnique({
      where: { id: batch.id },
      include: {
        uploadedFiles: true,
        orders: { include: { items: true } },
        processingLogs: true,
        processingErrors: true
      }
    });

    if (!reloaded || reloaded.uploadedFiles.length !== 1 || reloaded.orders.length !== 3) {
      throw new Error("CRUD relation smoke test did not reload expected records");
    }

    if (firstOrder.items.length !== 2 || firstOrder.processingLogs.length !== 1 || firstOrder.processingErrors.length !== 1) {
      throw new Error("Nested relation smoke test did not create expected records");
    }

    const firstPrice = firstOrder.items[0]?.price;
    if (!firstPrice || firstPrice.toString() !== "125.5") {
      throw new Error("Decimal field did not preserve expected value");
    }

    if (duplicateOrder.normalizedOrderCode !== "2609178X85CBMY") {
      throw new Error("Duplicate order code fixture was not inserted");
    }

    if (nullableOrder.customerName !== null || nullableOrder.amountCollected !== null) {
      throw new Error("Nullable business fields were not left NULL");
    }

    const updated = await prisma.batch.update({
      where: { id: batch.id },
      data: { processingStatus: "SUCCESS", orderCount: 3, successCount: 1 }
    });

    if (updated.processingStatus !== "SUCCESS" || updated.orderCount !== 3) {
      throw new Error("Batch update smoke test failed");
    }

    console.log("Stage 2 CRUD smoke test passed");
    console.log("Relations, Decimal values, duplicate order codes, and nullable fields verified");
  } finally {
    await prisma.batch.delete({ where: { id: batch.id } });
    const remaining = await prisma.batch.findUnique({ where: { id: batch.id } });
    if (remaining !== null) {
      throw new Error("Stage 2 test cleanup failed");
    }
    console.log("Stage 2 test records cleaned up");
  }
}

main()
  .catch((error: unknown) => {
    console.error("Stage 2 CRUD smoke test failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
