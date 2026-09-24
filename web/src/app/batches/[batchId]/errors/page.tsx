"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./errors.module.css";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
type Severity = "SUCCESS" | "WARNING" | "ERROR";
type ErrorItem = { id: string; severity: Severity; errorCode: string; message: string; sheetName: string | null; pageNumber: number | null; rowNumber: number | null; columnName: string | null; fieldName: string | null; createdAt: string; uploadedFile: { id: string; originalFilename: string; fileType: string; platform: string } | null };
type ErrorResponse = { batch: { id: string }; summary: { totalErrors: number; warningCount: number; errorCount: number }; pagination: { page: number; pageSize: number; total: number; totalPages: number }; files: Array<{ id: string; originalFilename: string; fileType: string }>; items: ErrorItem[] };
type ErrorDetail = ErrorItem & { rawValue: string | null; impact: string | null; suggestedAction: string | null; rawContext: unknown };

function display(value: unknown) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function location(item: Pick<ErrorItem, "sheetName" | "pageNumber" | "rowNumber" | "columnName">) {
  const parts = [item.sheetName && `Sheet: ${item.sheetName}`, item.pageNumber && `Trang: ${item.pageNumber}`, item.rowNumber && `Dòng: ${item.rowNumber}`, item.columnName && `Cột: ${item.columnName}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

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
      const response = await fetch(`${apiBaseUrl}/batches/${encodeURIComponent(batchId)}/errors?${query.toString()}`, { cache: "no-store" });
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
    const response = await fetch(`${apiBaseUrl}/batches/${encodeURIComponent(batchId)}/errors/${encodeURIComponent(id)}`, { cache: "no-store" });
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
      {data.items.length === 0 ? <section className={styles.state}><h2>{hasFilters ? "Không có lỗi phù hợp với bộ lọc hiện tại." : "Không có lỗi hoặc cảnh báo nào trong Batch này."}</h2>{hasFilters && <button type="button" onClick={() => updateQuery({ severity: undefined, errorCode: undefined, uploadedFileId: undefined, page: "1" })}>Xóa bộ lọc</button>}</section> : <section className={styles.tableWrap}><table><thead><tr><th>Mức độ</th><th>Mã lỗi</th><th>Thông báo</th><th>File</th><th>Vị trí</th><th>Trường</th><th>Thời gian</th><th><span className="sr-only">Chi tiết</span></th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><span className={`${styles.badge} ${styles[item.severity.toLowerCase()]}`}>{item.severity === "ERROR" ? "Lỗi" : item.severity === "WARNING" ? "Cảnh báo" : item.severity}</span></td><td><code>{item.errorCode}</code></td><td>{item.message}</td><td>{display(item.uploadedFile?.originalFilename)}</td><td>{location(item)}</td><td>{display(item.fieldName)}</td><td>{new Date(item.createdAt).toLocaleString("vi-VN")}</td><td><button type="button" onClick={() => void openDetail(item.id)}>Xem chi tiết</button></td></tr>)}</tbody></table></section>}
      {data.items.length > 0 && <nav className={styles.pagination} aria-label="Phân trang lỗi"><span>Trang {data.pagination.page} / {Math.max(data.pagination.totalPages, 1)} · {data.pagination.total} vấn đề</span><div><button type="button" disabled={data.pagination.page <= 1} onClick={() => updateQuery({ page: String(data.pagination.page - 1) })}>Trước</button><button type="button" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => updateQuery({ page: String(data.pagination.page + 1) })}>Sau</button></div></nav>}
      {detail && <section className={styles.detail} aria-label="Chi tiết lỗi"><div className={styles.detailHeader}><h2>Chi tiết: {detail.errorCode}</h2><button type="button" onClick={() => setDetail(null)}>Đóng</button></div><dl><Row label="Mức độ" value={detail.severity} /><Row label="Thông báo" value={detail.message} /><Row label="File" value={detail.uploadedFile?.originalFilename} /><Row label="Vị trí" value={location(detail)} /><Row label="Trường dữ liệu" value={detail.fieldName} /><Row label="Giá trị nguồn" value={detail.rawValue} /><Row label="Ảnh hưởng" value={detail.impact} /><Row label="Hành động đề xuất" value={detail.suggestedAction} /></dl><h3>Ngữ cảnh nguồn</h3><pre>{detail.rawContext === null || detail.rawContext === undefined ? "—" : JSON.stringify(detail.rawContext, null, 2)}</pre></section>}
    </>}
  </main>;
}

function Card({ label, value, tone }: { label: string; value: number; tone?: "error" | "warning" }) { return <article className={`${styles.card} ${tone ? styles[tone] : ""}`}><p>{label}</p><strong>{value}</strong></article>; }
function Row({ label, value }: { label: string; value: unknown }) { return <><dt>{label}</dt><dd>{display(value)}</dd></>; }
