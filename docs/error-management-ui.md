# Error Management UI

Stage 8 is a read-only view of persisted `ProcessingError` records. It does not retry parsing, alter source data, resolve, ignore, or delete errors.

## APIs

- `GET /api/batches/:batchId/errors` accepts `page`, `pageSize` (`20`, `50`, or `100`), `severity`, `errorCode`, and `uploadedFileId`.
- `GET /api/batches/:batchId/errors/:errorId` returns one error only when it belongs to the requested Batch. An unknown Batch, unknown error, or cross-Batch error lookup returns `404`.

The list summary is calculated from the full Batch, never just the current page or applied filter. List rows intentionally omit long raw values and raw context; the detail endpoint provides those fields.

## UI behavior and safety

The Error page is `/batches/[batchId]/errors`. Its filters and pagination use URL query parameters so a refresh preserves them. It renders source locations only when stored (sheet, row, column, or PDF page) and renders missing values as `—`.

Raw values and raw JSON context are rendered as escaped text. The API does not expose uploaded-file storage paths and redacts path- or secret-like strings in returned raw context. No source-derived content is rendered as HTML.

Error resolution workflow, History, Export, and Authentication remain outside Stage 8.
