import ExcelJS from "exceljs";

const api = "http://localhost:3001/api";
const pdf = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 35 >>
stream
BT /F1 12 Tf 72 720 Td (Queue PDF) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`);

export async function prepareBatch(label: string): Promise<string> {
  const batch = await fetch(`${api}/batches`, { method: "POST" }).then(async (response) => {
    if (!response.ok) throw new Error(`batch create ${response.status}`);
    return response.json() as Promise<{ id: string }>;
  });
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Orders").addRows([["Mã đơn sàn"], [`${label}_A`], [`${label}_B`]]);
  const form = new FormData();
  form.append("files", new Blob([Buffer.from(await workbook.xlsx.writeBuffer())], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${label}.xlsx`);
  form.append("files", new Blob([pdf], { type: "application/pdf" }), `${label}.pdf`);
  const upload = await fetch(`${api}/batches/${batch.id}/files`, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`upload ${upload.status}`);
  return batch.id;
}

export async function createQueuedBatch(label: string): Promise<{ batchId: string; jobId: string }> {
  const batchId = await prepareBatch(label);
  const queued = await fetch(`${api}/batches/${batchId}/process`, { method: "POST" });
  const body = await queued.json() as { jobId?: string };
  if (queued.status !== 202 || body.jobId !== `batch-${batchId}`) throw new Error(`enqueue ${queued.status} ${JSON.stringify(body)}`);
  return { batchId, jobId: body.jobId };
}

export async function waitForTerminal(batchId: string, timeoutMs = 30000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fetch(`${api}/batches/${batchId}/processing-status`).then((response) => response.json() as Promise<Record<string, unknown>>);
    if (status.processingStatus === "SUCCESS" || status.processingStatus === "ERROR") return status;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`terminal timeout for ${batchId}`);
}

if (process.argv[1]?.endsWith("queue-resilience-e2e.ts")) {
  const label = process.argv[2] ?? "STAGE11_RESILIENCE";
  const action = process.argv[3] === "--prepare" ? prepareBatch(label) : createQueuedBatch(label);
  action.then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
