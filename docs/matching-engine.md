# Matching Engine — Stage 6

Matching uses only `Mã đơn sàn` from persisted parser `rawData`. Normalization V1 uses the shared `normalizeOrderCode` function and only trims outer whitespace; case and internal whitespace remain unchanged. Customer name, phone, address, product, COD, filename and platform are never matching keys.

One unique normalized code produces one `Order`. Duplicate in either source takes precedence as `DUPLICATE`; otherwise statuses are `MATCHED`, `PDF_NOT_FOUND`, or `EXCEL_NOT_FOUND`. Business and financial fields remain NULL because Field Source Mapping is pending. `sourceRefs` stores concise file/row/page provenance only; parser raw data remains on UploadedFile.

`POST /api/batches/:batchId/match` requires one parsed Excel and parsed PDFs. It rebuilds Batch Orders and matching-level duplicate errors in a Serializable transaction, then updates order/status counts. Re-running is deterministic and does not alter parser raw data or parser errors.
