# Processing History

Stage 9 treats `Batch` as the processing-history record. `GET /api/batches/history` is read-only and supports `page`, `pageSize` (20, 50, 100), and an exact Batch processing-status filter. Results are sorted by `createdAt DESC`, then ID.

The API returns only Batch metadata and DB-derived counts: file counts, Master Order count, matched orders, and `ProcessingError` warning/error counts. It does not expose storage paths, raw files, customer payloads, or raw error context. Aggregate `groupBy` queries calculate counts for the current page of Batches, avoiding one query per row.

`/history` persists filters and pagination in the URL and links only to existing Result and Error screens. Stage 9 does not delete, archive, rerun, retry, duplicate, export, or modify any Batch.
