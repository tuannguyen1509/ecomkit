import ExcelJS from "exceljs";
import { HttpException } from "@nestjs/common";
import { prisma } from "@ecomkit/database";
import { BatchesService } from "./batches.service.js";

const service = new BatchesService();
let id = "";
let otherId = "";
let emptyId = "";
const ok = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const headers = ["Ngày Lên Đơn", "Mã đơn ESHOP", "Mã đơn sàn", "Kênh Bán Hàng", "Trạng Thái Đơn Hàng", "Tên Khách Hàng", "SĐT", "Địa Chỉ", "Tỉnh/TP", "Ngày Xuất VAT", "Ghi Chú", "Đã Thu Tiền", "Trạng Thái Công Nợ", "Chênh lệch", "Giá SP (VAT 8%)", "% Tổng Chi Phí", "Tổng Tiền Sẽ Thu", "Phí Affiliate (Vui Khỏe)", "Chiết Khấu (Vui Khỏe)", "% Chiết Khấu Vui Khỏe", "Phí Cố Định (TMĐT)", "Phí dịch vụ (TMĐT)", "Phí Giao Dịch (TMĐT)", "% Chi Phí Sàn TMĐT"];

async function expectHttp(status: number, action: () => Promise<unknown>) {
  try { await action(); throw new Error(`expected HTTP ${status}`); }
  catch (error) { ok(error instanceof HttpException && error.getStatus() === status, `expected HTTP ${status}`); }
}

async function main() {
  const batch = await prisma.batch.create({ data: { createdByUserId: "STAGE10_TEST", orderCount: 125 } }); id = batch.id;
  await prisma.order.createMany({ data: Array.from({ length: 125 }, (_, index) => ({
    batchId: id, rawOrderCode: index === 0 ? "=CODE,\"x\"" : index === 1 ? "00123456789" : `ORD${index}`,
    normalizedOrderCode: `ORD${index}`, matchingStatus: index < 2 ? "MATCHED" : "PDF_NOT_FOUND",
    customerName: index === 0 ? "Nguyễn Thị Ánh,\nĐường Nguyễn Huệ" : null
  })) });
  const other = await prisma.batch.create({ data: { createdByUserId: "STAGE10_TEST", orderCount: 1 } }); otherId = other.id;
  await prisma.order.create({ data: { batchId: otherId, rawOrderCode: "OTHER_BATCH", normalizedOrderCode: "OTHER_BATCH", matchingStatus: "MATCHED" } });

  const xlsx = await service.exportOrders(id, { format: "xlsx", status: "ALL" });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.content as never); const sheet = workbook.worksheets[0];
  ok(sheet.rowCount === 126 && sheet.getRow(1).cellCount === 24, "xlsx row/header count");
  ok(headers.every((header, index) => sheet.getRow(1).getCell(index + 1).value === header), "xlsx header order");
  ok(sheet.getRow(2).getCell(3).value === "=CODE,\"x\"" && sheet.getRow(2).getCell(3).type === ExcelJS.ValueType.String, "xlsx formula safety");
  ok(sheet.getRow(3).getCell(3).value === "00123456789" && sheet.getRow(2).getCell(1).value === null, "xlsx text/null safety");
  const csvAll = await service.exportOrders(id, { format: "csv", status: "ALL" }); const allText = csvAll.content.toString("utf8");
  ok(allText.startsWith("\uFEFF") && allText.includes("'=CODE,\"\"x\"\"") && allText.includes("Nguyễn Thị Ánh,\nĐường Nguyễn Huệ") && !allText.includes("OTHER_BATCH"), "csv encoding, escaping, isolation");
  const csv = await service.exportOrders(id, { format: "csv", status: "MATCHED" }); const text = csv.content.toString("utf8");
  ok(text.startsWith("\uFEFF") && text.includes("'=CODE") && text.includes("00123456789"), "csv/status filter");
  emptyId = (await prisma.batch.create({ data: { createdByUserId: "STAGE10_TEST" } })).id;
  await expectHttp(404, () => service.exportOrders("00000000-0000-0000-0000-000000000000", { format: "csv", status: "ALL" }));
  await expectHttp(409, () => service.exportOrders(emptyId, { format: "csv", status: "ALL" }));
  console.log("Stage 10 export integration passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (!process.env.STAGE10_KEEP_TEST_DATA) for (const batchId of [id, otherId, emptyId]) if (batchId) await prisma.batch.delete({ where: { id: batchId } }).catch(() => {});
  await prisma.$disconnect();
});
