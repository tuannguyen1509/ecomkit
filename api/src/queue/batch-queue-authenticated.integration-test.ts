import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "@ecomkit/database";
import { AuthService } from "../auth/auth.service.js";

const apiUrl = process.env.API_TEST_URL ?? "http://localhost:3001/api";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const username = `stage14_batch_queue_${suffix}`;
const password = `${randomBytes(24).toString("base64url")}!Aa`;
const storageRoot = resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage");
const batchIds: string[] = [];

function assertStatus(response: Response, expected: number, label: string): void {
  assert.equal(response.status, expected, `${label}: HTTP ${response.status}`);
}

function pdf(lines: string[]): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td ${lines.map((line, index) => `${index ? "0 -18 Td " : ""}(${line.replace(/[\\()]/g, "\\$&")}) Tj`).join(" ")} ET`;
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) { offsets[index] = Buffer.byteLength(output); output += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

async function workbook(header: string, code: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Synthetic");
  sheet.addRow([header]);
  sheet.addRow([code]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function request(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Cookie: cookie, Origin: webOrigin, ...(init.headers ?? {}) }
  });
}

async function createBatch(cookie: string): Promise<string> {
  const response = await request("/batches", cookie, { method: "POST" });
  assertStatus(response, 201, "create Batch");
  const body = await response.json() as { id: string };
  batchIds.push(body.id);
  return body.id;
}

async function upload(batchId: string, cookie: string, files: Array<{ name: string; type: string; data: Buffer }>): Promise<void> {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([Uint8Array.from(file.data)], { type: file.type }), file.name);
  assertStatus(await request(`/batches/${batchId}/files`, cookie, { method: "POST", body: form }), 201, "upload files");
}

async function terminal(batchId: string, cookie: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await request(`/batches/${batchId}/processing-status`, cookie);
    assertStatus(response, 200, "read Batch status");
    const status = await response.json() as Record<string, unknown>;
    if (status.processingStatus === "SUCCESS" || status.processingStatus === "ERROR") return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("BATCH_QUEUE_TEST_TIMEOUT");
}

async function run(): Promise<void> {
  const auth = new AuthService();
  const user = await prisma.user.create({ data: { username, displayName: "Stage 14 Queue Test", passwordHash: await auth.hashPassword(password), role: "USER" } });
  try {
    const login = await fetch(`${apiUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: webOrigin }, body: JSON.stringify({ username, password }) });
    assertStatus(login, 200, "login");
    const session = login.headers.get("set-cookie")?.match(/ecomkit_session=([^;]+)/)?.[1];
    assert.ok(session, "login did not issue a session cookie");
    const cookie = `ecomkit_session=${session}`;
    assertStatus(await request("/auth/me", cookie), 200, "session bootstrap");

    const successBatch = await createBatch(cookie);
    const code = "2609178X85CBMY";
    await upload(successBatch, cookie, [
      { name: "synthetic-orders.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await workbook("Mã đơn sàn", code) },
      { name: "synthetic-shopee.pdf", type: "application/pdf", data: pdf([`SPX ${code}`]) }
    ]);
    assertStatus(await request(`/batches/${successBatch}/process`, cookie, { method: "POST" }), 202, "enqueue successful Batch");
    const success = await terminal(successBatch, cookie);
    assert.equal(success.processingStatus, "SUCCESS");
    const result = await request(`/batches/${successBatch}/results?page=1&pageSize=20`, cookie);
    assertStatus(result, 200, "result API");
    const orders = await prisma.order.findMany({ where: { batchId: successBatch } });
    assert.equal(orders.length, 1);
    assert.equal(orders[0]?.rawOrderCode, code);
    assert.equal(orders[0]?.matchingStatus, "MATCHED");

    const errorBatch = await createBatch(cookie);
    await upload(errorBatch, cookie, [
      { name: "synthetic-invalid.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await workbook("Wrong header", code) },
      { name: "synthetic-shopee.pdf", type: "application/pdf", data: pdf([`SPX ${code}`]) }
    ]);
    assertStatus(await request(`/batches/${errorBatch}/process`, cookie, { method: "POST" }), 202, "enqueue invalid Batch");
    const failure = await terminal(errorBatch, cookie);
    assert.equal(failure.processingStatus, "ERROR");
    assert.equal(failure.currentStage, "failed");
    assert.equal(await prisma.processingError.count({ where: { batchId: errorBatch, errorCode: "EXCEL_REQUIRED_COLUMN_MISSING" } }), 1);
    assert.equal(await prisma.marketplaceSyncError.count({ where: { syncRun: { batchId: errorBatch } } }), 0);
    console.log("authenticated batch queue regression test passed");
  } finally {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    for (const batchId of batchIds) {
      await prisma.batch.delete({ where: { id: batchId } }).catch(() => undefined);
      await rm(join(storageRoot, "uploads", batchId), { recursive: true, force: true });
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "authenticated batch queue regression test failed");
  process.exitCode = 1;
});
