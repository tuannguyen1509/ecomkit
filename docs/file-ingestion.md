# Stage 3 — File Ingestion + Batch

Stage 3 accepts one `.xlsx` file and zero or more `.pdf` files per Batch. It stores files and metadata only; Excel/PDF parsing, platform detection, order creation, and matching are deferred.

## Endpoints

- `POST /api/batches` creates a `PENDING` Batch.
- `POST /api/batches/:batchId/files` accepts multipart field `files`.
- `GET /api/batches/:batchId` returns Batch and safe file metadata without `storagePath` or physical content.

## Rules and validation

- Extensions are case-insensitive and limited to `.xlsx` and `.pdf`.
- PDF must start with `%PDF-`.
- XLSX must be a readable ZIP container with `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`.
- Empty files, fake signatures, unsupported extensions, excess size, and excess file count are rejected.
- The request is atomic: if one submitted file is invalid, none of that request's files are persisted.
- A second Excel file is rejected; PDFs can be added later.
- Original names are retained as metadata. Filesystem names are generated UUID names and sanitized input never determines a path.

## Storage and consistency

Runtime files are stored in `storage/uploads/<batch-id>/` through the Docker bind mount `./storage:/app/storage`. Temporary multipart files use `storage/tmp/` and are cleaned up on success, validation failure, and exceptions.

The API writes final files before the PostgreSQL transaction. If metadata insertion or count update fails, only the final files from that request are removed. The transaction writes all `UploadedFile` rows and recalculates Batch file counts from database state.

## Environment

```text
UPLOAD_STORAGE_ROOT=/app/storage
UPLOAD_MAX_FILE_SIZE_MB=25
UPLOAD_MAX_FILES_PER_BATCH=100
```

These are deployment safety limits, not immutable business rules. Upload storage is private and ignored by Git.
