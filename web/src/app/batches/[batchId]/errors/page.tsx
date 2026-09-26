"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./errors.module.css";
import { apiFetch } from "../../../../lib/api";

type Severity = "SUCCESS" | "WARNING" | "ERROR";
type ErrorItem = { id: string; severity: Severity; errorCode: string; message: string; sheetName: string | null; pageNumber: number | null; rowNumber: number | null; columnName: string | null; fieldName: string | null; createdAt: string; uploadedFile: { id: string; originalFilename: string; fileType: string; platform: string } | null };
type ErrorResponse = { batch: { id: string }; summary: { totalErrors: number; warningCount: number; errorCount: number }; pagination: { page: number; pageSize: number; total: number; totalPages: number }; files: Array<{ id: string; originalFilename: string; fileType: string }>; items: ErrorItem[] };
type ErrorDetail = ErrorItem & { rawValue: string | null; impact: string | null; suggestedAction: string | null; rawContext: unknown };

function display(value: unknown) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function location(item: Pick<ErrorItem, "sheetName" | "pageNumber" | "rowNumber" | "columnName">) {
  const parts = [item.sheetName && `Sheet: ${item.sheetName}`, item.pageNumber && `Trang: ${item.pageNumber}`, item.rowNumber && `Dòng: ${item.rowNumber}`, item.columnName && `Cột: ${item.columnName}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}
function source(code: string, fileType?: string) { if (code.startsWith("EXCEL_") || fileType === "EXCEL") return "Excel"; if (code.startsWith("PDF_") || fileType === "PDF") return "PDF"; if (code === "DUPLICATE_ORDER" || code === "MATCH_FAILED") return "Đối chiếu"; if (code.startsWith("API_")) return "API"; return "Khác"; }
function marketplace(platform?: string) { return platform === "SHOPEE" ? "Shopee" : platform === "LAZADA" ? "Lazada" : platform === "TIKTOK" ? "TikTok Shop" : "Chưa xác định sàn"; }
function stage(code: string, fileType?: string) { const value = source(code, fileType); return value === "Excel" ? "Đọc dữ liệu Excel" : value === "PDF" ? "Đọc PDF" : value === "Đối chiếu" ? "Đối chiếu mã đơn sàn" : value; }

export default function BatchErrorsPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ErrorResponse | null>(null);
  const [detail, setDetail] = useState<ErrorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not-found" | "request" | null>(null);

  const query = useMemo(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (!next.get("page")) next.set("page", "1");
    if (!next.get("pageSize")) next.set("pageSize", "20");
    return next;
  }, [searchParams]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiFetch(`/batches/${encodeURIComponent(batchId)}/errors?${query.toString()}`);
      if (!response.ok) { setError(response.status === 404 ? "not-found" : "request"); return; }
      setData(await response.json() as ErrorResponse);
    } catch { setError("request"); } finally { setLoading(false); }
  }, [batchId, query]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const updateQuery = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query.toString());
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.push(`${pathname}?${next.toString()}`);
  };
  const openDetail = async (id: string) => {
    const response = await apiFetch(`/batches/${encodeURIComponent(batchId)}/errors/${encodeURIComponent(id)}`);
    if (response.ok) setDetail(await response.json() as ErrorDetail);
  };
  const hasFilters = Boolean(query.get("severity") || query.get("errorCode") || query.get("uploadedFileId"));

  return <main className={styles.page}>
    <header className={styles.header}><a href={`/batches/${batchId}/results`}>← Kết quả đối chiếu</a><p className={styles.brand}>Ecomkit - Vui Khỏe</p><h1>Lỗi & cảnh báo</h1><p>Batch <code>{batchId}</code></p></header>
    {loading && <section className={styles.state} aria-live="polite">Đang tải lỗi & cảnh báo...</section>}
    {!loading && error && <section className={styles.state} role="alert"><h2>{error === "not-found" ? "Không tìm thấy Batch." : "Không thể tải danh sách lỗi và cảnh báo."}</h2>{error === "request" && <button type="button" onClick={() => void load()}>Thử lại</button>}</section>}
    {!loading && !error && data && <>
      <section className={styles.cards} aria-label="Tóm tắt lỗi"><Card label="Tổng vấn đề" value={data.summary.totalErrors} /><Card label="Lỗi" value={data.summary.errorCount} tone="error" /><Card label="Cảnh báo" value={data.summary.warningCount} tone="warning" /></section>
      <section className={styles.filters} aria-label="Bộ lọc lỗi">
        <label>Mức độ<select value={query.get("severity") ?? ""} onChange={(event) => updateQuery({ severity: event.target.value || undefined, page: "1" })}><option value="">Tất cả</option><option value="ERROR">Lỗi</option><option value="WARNING">Cảnh báo</option></select></label>
        <label>Mã lỗi<input value={query.get("errorCode") ?? ""} onChange={(event) => updateQuery({ errorCode: event.target.value.toUpperCase() || undefined, page: "1" })} placeholder="Ví dụ: PDF_READ_ERROR" /></label>
        <label>File<select value={query.get("uploadedFileId") ?? ""} onChange={(event) => updateQuery({ uploadedFileId: event.target.value || undefined, page: "1" })}><option value="">Tất cả file</option>{data.files.map((file) => <option key={file.id} value={file.id}>{file.originalFilename}</option>)}</select></label>
        <label>Số dòng<select value={data.pagination.pageSize} onChange={(event) => updateQuery({ pageSize: event.target.value, page: "1" })}>{[20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </section>
      {data.items.length === 0 ? <section className={styles.state}><h2>{hasFilters ? "Không có lỗi phù hợp với bộ lọc hiện tại." : "Không có lỗi hoặc cảnh báo nào trong Batch này."}</h2>{hasFilters && <button type="button" onClick={() => updateQuery({ severity: undefined, errorCode: undefined, uploadedFileId: undefined, page: "1" })}>Xóa bộ lọc</button>}</section> : <section className={styles.tableWrap}><table><thead><tr><th>Mức độ</th><th>Nguồn</th><th>Sàn</th><th>Tên file</th><th>Vị trí</th><th>Mã lỗi</th><th>Thông báo</th><th><span className="sr-only">Chi tiết</span></th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><span className={`${styles.badge} ${styles[item.severity.toLowerCase()]}`}>{item.severity === "ERROR" ? "Lỗi" : item.severity === "WARNING" ? "Cảnh báo" : item.severity}</span></td><td>{source(item.errorCode,item.uploadedFile?.fileType)}</td><td>{marketplace(item.uploadedFile?.platform)}</td><td>{display(item.uploadedFile?.originalFilename)}</td><td>{location(item)}</td><td><code>{item.errorCode}</code></td><td>{item.message}</td><td><button type="button" onClick={() => void openDetail(item.id)}>Xem chi tiết</button></td></tr>)}</tbody></table></section>}
      {data.items.length > 0 && <nav className={styles.pagination} aria-label="Phân trang lỗi"><span>Trang {data.pagination.page} / {Math.max(data.pagination.totalPages, 1)} · {data.pagination.total} vấn đề</span><div><button type="button" disabled={data.pagination.page <= 1} onClick={() => updateQuery({ page: String(data.pagination.page - 1) })}>Trước</button><button type="button" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => updateQuery({ page: String(data.pagination.page + 1) })}>Sau</button></div></nav>}
      {detail && <section className={styles.detail} aria-label="Chi tiết lỗi"><div className={styles.detailHeader}><h2>Chi tiết lỗi</h2><button type="button" onClick={() => setDetail(null)}>Đóng</button></div><h3>Nguồn lỗi</h3><dl><Row label="Batch" value={batchId} /><Row label="Tên file" value={detail.uploadedFile?.originalFilename} /><Row label="Loại nguồn" value={source(detail.errorCode,detail.uploadedFile?.fileType)} /><Row label="Sàn" value={marketplace(detail.uploadedFile?.platform)} /><Row label="Công đoạn" value={stage(detail.errorCode,detail.uploadedFile?.fileType)} /><Row label="Vị trí" value={location(detail)} /></dl><h3>Chi tiết kỹ thuật</h3><dl><Row label="Mã lỗi kỹ thuật" value={detail.errorCode} /><Row label="Mô tả" value={detail.message} /><Row label="Trường dữ liệu" value={detail.fieldName} /><Row label="Giá trị gặp lỗi" value={detail.rawValue} /><Row label="Ảnh hưởng" value={detail.impact} /></dl><h3>Cần kiểm tra / chỉnh sửa</h3><p>{detail.suggestedAction ?? "Kiểm tra lại dữ liệu nguồn tại vị trí được chỉ ra ở trên."}</p><h3>Ngữ cảnh nguồn</h3><pre>{detail.rawContext === null || detail.rawContext === undefined ? "—" : JSON.stringify(detail.rawContext, null, 2)}</pre></section>}
    </>}
  </main>;
}

function Card({ label, value, tone }: { label: string; value: number; tone?: "error" | "warning" }) { return <article className={`${styles.card} ${tone ? styles[tone] : ""}`}><p>{label}</p><strong>{value}</strong></article>; }
function Row({ label, value }: { label: string; value: unknown }) { return <><dt>{label}</dt><dd>{display(value)}</dd></>; }
