"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./history.module.css";
import { apiBaseUrl as api, apiFetch } from "../../lib/api";

type Item = { id: string; createdAt: string; processingStatus: "PENDING" | "PROCESSING" | "SUCCESS" | "WARNING" | "ERROR"; fileCount: number; excelFileCount: number; pdfFileCount: number; orderCount: number; matchedCount: number; warningCount: number; errorCount: number };
type Response = { pagination: { page: number; pageSize: number; total: number; totalPages: number }; items: Item[] };
const labels: Record<Item["processingStatus"], string> = { PENDING: "Chờ xử lý", PROCESSING: "Đang xử lý", SUCCESS: "Hoàn tất", WARNING: "Hoàn tất có cảnh báo", ERROR: "Có lỗi" };

export default function HistoryPage() { return <Suspense fallback={<main className={styles.page}><section className={styles.state}>Đang tải lịch sử xử lý...</section></main>}><HistoryContent /></Suspense>; }

function HistoryContent() {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const [data, setData] = useState<Response | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const query = useMemo(() => { const next = new URLSearchParams(search.toString()); if (!next.get("page")) next.set("page", "1"); if (!next.get("pageSize")) next.set("pageSize", "20"); return next; }, [search]);
  const load = useCallback(async () => { setLoading(true); setFailed(false); try { const response = await apiFetch(`/batches/history?${query}`); if (!response.ok) throw new Error(); setData(await response.json() as Response); } catch { setFailed(true); } finally { setLoading(false); } }, [query]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const setQuery = (changes: Record<string, string | undefined>) => { const next = new URLSearchParams(query); Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); router.push(`${pathname}?${next}`); };
  const filtered = Boolean(query.get("status"));
  return <main className={styles.page}>
    <header><p className={styles.brand}>Ecomkit - Vui Khỏe</p><h1>Lịch sử xử lý</h1><p>Xem lại các Batch đã nhập và đối chiếu trước đây.</p></header>
    {loading && <section className={styles.state}>Đang tải lịch sử xử lý...</section>}
    {!loading && failed && <section className={styles.state} role="alert"><h2>Không thể tải lịch sử xử lý.</h2><button onClick={() => void load()}>Thử lại</button></section>}
    {!loading && !failed && data && <>
      <section className={styles.filters}><label>Trạng thái<select value={query.get("status") ?? ""} onChange={(event) => setQuery({ status: event.target.value || undefined, page: "1" })}><option value="">Tất cả trạng thái</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Số dòng<select value={data.pagination.pageSize} onChange={(event) => setQuery({ pageSize: event.target.value, page: "1" })}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label></section>
      {data.items.length === 0 ? <section className={styles.state}><h2>{filtered ? "Không có Batch phù hợp với bộ lọc hiện tại." : "Chưa có lịch sử xử lý."}</h2>{filtered && <button onClick={() => setQuery({ status: undefined, page: "1" })}>Xóa bộ lọc</button>}</section> : <section className={styles.tableWrap}><table><thead><tr><th>Thời gian</th><th>Batch</th><th>Trạng thái</th><th>File</th><th>Đơn hàng</th><th>Đã đối chiếu</th><th>Cảnh báo</th><th>Lỗi</th><th>Thao tác</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString("vi-VN")}</td><td><code>{item.id}</code></td><td>{labels[item.processingStatus]}</td><td>{item.fileCount} <small>({item.excelFileCount} Excel · {item.pdfFileCount} PDF)</small></td><td>{item.orderCount}</td><td>{item.matchedCount}</td><td>{item.warningCount}</td><td>{item.errorCount}</td><td><a href={`/batches/${item.id}/results`}>Xem kết quả</a><a href={`/batches/${item.id}/errors`}>Xem lỗi & cảnh báo</a></td></tr>)}</tbody></table></section>}
      {data.items.length > 0 && <nav className={styles.pagination}><span>Trang {data.pagination.page} / {Math.max(data.pagination.totalPages, 1)} · {data.pagination.total} Batch</span><div><button disabled={data.pagination.page <= 1} onClick={() => setQuery({ page: String(data.pagination.page - 1) })}>Trước</button><button disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setQuery({ page: String(data.pagination.page + 1) })}>Sau</button></div></nav>}
    </>}
  </main>;
}
