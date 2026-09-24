"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BatchResultsResponse, MatchingStatus, ResultOrder } from "../../../../types/results";
import styles from "./results.module.css";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const statusLabels: Record<MatchingStatus, string> = {
  MATCHED: "Đã đối chiếu",
  PDF_NOT_FOUND: "Không thấy trong PDF",
  EXCEL_NOT_FOUND: "Không thấy trong Excel",
  DUPLICATE: "Trùng mã đơn",
  PARSE_ERROR: "Lỗi đọc dữ liệu"
};
const statusGroup: Record<MatchingStatus, "success" | "warning" | "error"> = {
  MATCHED: "success",
  PDF_NOT_FOUND: "warning",
  EXCEL_NOT_FOUND: "warning",
  DUPLICATE: "error",
  PARSE_ERROR: "error"
};
const statusOptions: MatchingStatus[] = ["MATCHED", "PDF_NOT_FOUND", "EXCEL_NOT_FOUND", "DUPLICATE", "PARSE_ERROR"];

function formatCode(order: ResultOrder): string {
  return order.rawOrderCode ?? order.normalizedOrderCode ?? "—";
}

function sourceIndicator(order: ResultOrder, source: "EXCEL" | "PDF"): string {
  const candidate = order.sourceRefs?.candidates?.find((item) => item.source === source);
  if (!candidate) return "—";
  if (source === "EXCEL" && candidate.row) return `Excel · dòng ${candidate.row}`;
  if (source === "PDF" && candidate.page) return `PDF · trang ${candidate.page}`;
  return source === "EXCEL" ? "Excel ✓" : "PDF ✓";
}

function resultUrl(batchId: string, params: URLSearchParams): string {
  return `${apiBaseUrl}/batches/${encodeURIComponent(batchId)}/results?${params.toString()}`;
}

export default function BatchResultsPage() {
  const route = useParams<{ batchId: string }>();
  const batchId = route.batchId;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<BatchResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ kind: "not-found" | "request"; message: string } | null>(null);

  const query = useMemo(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (!next.get("page")) next.set("page", "1");
    if (!next.get("pageSize")) next.set("pageSize", "20");
    return next;
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(resultUrl(batchId, query), { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        setError({
          kind: response.status === 404 ? "not-found" : "request",
          message: body?.message ?? "Không thể tải kết quả Batch."
        });
        return;
      }
      setData(await response.json() as BatchResultsResponse);
    } catch {
      setError({ kind: "request", message: "Không thể tải kết quả Batch. Vui lòng thử lại." });
    } finally {
      setLoading(false);
    }
  }, [batchId, query]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const setQuery = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  const currentStatus = query.get("status") as MatchingStatus | null;
  const currentGroup = query.get("group");
  const group = currentStatus ? statusGroup[currentStatus] : currentGroup === "success" || currentGroup === "warning" || currentGroup === "error" ? currentGroup : "all";
  const setGroup = (nextGroup: "all" | "success" | "warning" | "error") => {
    setQuery({ status: undefined, group: nextGroup === "all" ? undefined : nextGroup, page: "1" });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.brand}>Ecomkit - Vui Khỏe</p>
        <h1>Kết quả xử lý</h1>
        <p>Batch <code>{batchId}</code></p>
        <p><a href={`/batches/${batchId}/errors`}>Xem lỗi & cảnh báo</a></p>
      </header>

      {loading && <section className={styles.state} aria-live="polite">Đang tải kết quả...</section>}
      {!loading && error && (
        <section className={styles.state} role="alert">
          <h2>{error.kind === "not-found" ? "Không tìm thấy Batch." : "Không thể tải kết quả Batch."}</h2>
          <p>{error.kind === "not-found" ? "Kiểm tra lại đường dẫn Batch rồi thử lại." : error.message}</p>
          {error.kind === "request" && <button type="button" onClick={() => void load()}>Thử lại</button>}
        </section>
      )}
      {!loading && !error && data && <Results data={data} currentStatus={currentStatus} group={group} onSetQuery={setQuery} onSetGroup={setGroup} />}
    </main>
  );
}

function Results({ data, currentStatus, group, onSetQuery, onSetGroup }: {
  data: BatchResultsResponse;
  currentStatus: MatchingStatus | null;
  group: "all" | "success" | "warning" | "error";
  onSetQuery: (updates: Record<string, string | undefined>) => void;
  onSetGroup: (group: "all" | "success" | "warning" | "error") => void;
}) {
  const hasOrders = data.summary.totalOrders > 0;
  const isFilterEmpty = hasOrders && data.pagination.total === 0;
  const canGoPrevious = data.pagination.page > 1;
  const canGoNext = data.pagination.page < data.pagination.totalPages;

  return <>
    <section className={styles.cards} aria-label="Tóm tắt Batch">
      <Stat label="Tổng file" value={data.summary.totalFiles} />
      <Stat label="Tổng đơn" value={data.summary.totalOrders} />
      <Stat label="Thành công" value={data.summary.success} tone="success" />
      <Stat label="Cảnh báo" value={data.summary.warning} tone="warning" />
      <Stat label="Lỗi" value={data.summary.error} tone="error" />
    </section>

    <section className={styles.matching} aria-label="Tóm tắt đối chiếu">
      <h2>Tóm tắt đối chiếu</h2>
      <dl>
        <div><dt>Đã đối chiếu</dt><dd>{data.matching.matched}</dd></div>
        <div><dt>Không thấy PDF</dt><dd>{data.matching.pdfNotFound}</dd></div>
        <div><dt>Không thấy Excel</dt><dd>{data.matching.excelNotFound}</dd></div>
        <div><dt>Trùng mã</dt><dd>{data.matching.duplicate}</dd></div>
        <div><dt>Lỗi đọc dữ liệu</dt><dd>{data.matching.parseError}</dd></div>
      </dl>
    </section>

    {!hasOrders ? <section className={styles.state}><h2>Batch này chưa có kết quả đối chiếu.</h2><p>Mở trang này không tự chạy đối chiếu. Hãy hoàn tất Matching trước khi xem kết quả.</p></section> : <>
      <section className={styles.filters} aria-label="Bộ lọc kết quả">
        <div className={styles.primaryFilters} role="group" aria-label="Nhóm kết quả">
          {(["all", "success", "warning", "error"] as const).map((item) => <button key={item} type="button" className={group === item ? styles.activeFilter : ""} onClick={() => onSetGroup(item)}>
            {{ all: "Tất cả", success: "Thành công", warning: "Cảnh báo", error: "Lỗi" }[item]}
          </button>)}
        </div>
        <label>
          Trạng thái đối chiếu
          <select value={currentStatus ?? ""} onChange={(event) => onSetQuery({ status: event.target.value || undefined, group: undefined, page: "1" })}>
            <option value="">Tất cả trạng thái</option>
            {statusOptions.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
        </label>
        <label>
          Số dòng
          <select value={data.pagination.pageSize} onChange={(event) => onSetQuery({ pageSize: event.target.value, page: "1" })}>
            {[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </section>

      {isFilterEmpty ? <section className={styles.state}><h2>Không có đơn hàng phù hợp với bộ lọc hiện tại.</h2><button type="button" onClick={() => onSetQuery({ status: undefined, group: undefined, page: "1" })}>Xóa bộ lọc</button></section> : <section className={styles.tableWrap} aria-label="Danh sách Master Orders">
        <table>
          <thead><tr><th>Mã đơn sàn</th><th>Kênh</th><th>Trạng thái đối chiếu</th><th>Nguồn Excel</th><th>Nguồn PDF</th><th>Cảnh báo/Lỗi</th></tr></thead>
          <tbody>{data.orders.map((order) => <tr key={order.id}>
            <td>{formatCode(order)}</td><td>{order.platform === "UNKNOWN" ? "—" : order.platform}</td>
            <td><span className={`${styles.badge} ${styles[statusGroup[order.matchingStatus]]}`}>{statusLabels[order.matchingStatus]}</span></td>
            <td>{sourceIndicator(order, "EXCEL")}</td><td>{sourceIndicator(order, "PDF")}</td>
            <td>{statusGroup[order.matchingStatus] === "success" ? "0 lỗi" : statusGroup[order.matchingStatus] === "warning" ? "1 cảnh báo" : "1 lỗi"}</td>
          </tr>)}</tbody>
        </table>
      </section>}

      {!isFilterEmpty && <nav className={styles.pagination} aria-label="Phân trang kết quả">
        <span>Trang {data.pagination.page} / {Math.max(data.pagination.totalPages, 1)} · {data.pagination.total} đơn</span>
        <div><button type="button" disabled={!canGoPrevious} aria-label="Trang trước" onClick={() => onSetQuery({ page: String(data.pagination.page - 1) })}>Trước</button><button type="button" disabled={!canGoNext} aria-label="Trang sau" onClick={() => onSetQuery({ page: String(data.pagination.page + 1) })}>Sau</button></div>
      </nav>}
    </>}
  </>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "error" }) {
  return <article className={`${styles.card} ${tone ? styles[tone] : ""}`}><p>{label}</p><strong>{value}</strong></article>;
}
