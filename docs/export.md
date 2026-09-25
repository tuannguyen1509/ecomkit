# Export

`GET /api/batches/:batchId/export?format=xlsx|csv&status=ALL|MATCHED|PDF_NOT_FOUND|EXCEL_NOT_FOUND|DUPLICATE|PARSE_ERROR` exports all persisted Master Orders, never the Result UI page alone. Rows use `createdAt ASC, id ASC`; one Order is one row.

The canonical 24 Master Output columns are: Ngày Lên Đơn; Mã đơn ESHOP; Mã đơn sàn; Kênh Bán Hàng; Trạng Thái Đơn Hàng; Tên Khách Hàng; SĐT; Địa Chỉ; Tỉnh/TP; Ngày Xuất VAT; Ghi Chú; Đã Thu Tiền; Trạng Thái Công Nợ; Chênh lệch; Giá SP (VAT 8%); % Tổng Chi Phí; Tổng Tiền Sẽ Thu; Phí Affiliate (Vui Khỏe); Chiết Khấu (Vui Khỏe); % Chiết Khấu Vui Khỏe; Phí Cố Định (TMĐT); Phí dịch vụ (TMĐT); Phí Giao Dịch (TMĐT); % Chi Phí Sàn TMĐT.

Null values are blank. No financial calculation, raw source data, paths, UUIDs, or error payloads are exported. A Batch without Master Orders is rejected with a structured `409 BATCH_NOT_MATCHED` response.

XLSX uses ExcelJS with text values for codes. CSV is UTF-8 with BOM and CSV escaping. Values beginning with `=`, `+`, `-`, or `@` are prefixed with an apostrophe in CSV to prevent spreadsheet formula execution while preserving the underlying text representation.
