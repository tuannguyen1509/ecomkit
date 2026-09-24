# Excel Parser — Stage 4

Stage 4 parses only an already-uploaded `.xlsx` file through `POST /api/batches/:batchId/excel/parse`. It never parses PDF, creates `Order`, matches records, or writes Master Order fields.

The parser requires exactly one Excel file in the Batch. Without a confirmed production workbook, it uses deterministic technical-fixture behavior: one worksheet only and header row 1. A workbook with no sheet or more than one sheet returns `EXCEL_SHEET_NOT_FOUND`; it does not silently choose the first sheet.

The required header is exactly `Mã đơn sàn` after trimming outer header whitespace. No fuzzy header aliases are accepted. Empty header row returns `EXCEL_HEADER_MISSING`; a non-empty header row missing that exact column returns `EXCEL_REQUIRED_COLUMN_MISSING`.

Each non-empty row retains raw cell values, Excel row number, raw order code and trimmed `normalized_order_code` in `UploadedFile.rawData`. Normalization V1 only trims leading/trailing whitespace. It does not alter case, hyphens, internal spaces or typos. A fully empty row is skipped. A row with other data but missing order code yields `EXCEL_EMPTY_ORDER_CODE`.

Duplicate detection uses a `Map` in O(n), based only on trimmed normalized code. `ORDER001` and ` ORDER001 ` are duplicates; `order001` and `ORDER001` are not. Duplicate rows remain in raw data and receive `EXCEL_DUPLICATE_ORDER_CODE` with current and first-seen row context.

Formula cells are never evaluated or executed. A cached formula result may be read; a formula with no cached result records `EXCEL_READ_ERROR`. Macros, external links, `.xls`, `.xlsm` and `.csv` are unsupported.

Each parse replaces only parser-generated `EXCEL_*` errors for that `uploaded_file_id`, updates that file's `rawData` and `processingStatus`, then inserts the current parse errors. Reparse is therefore idempotent and never removes errors from other files. `SUCCESS` means no Excel parser error; `ERROR` means one or more errors. Batch status and file counts are not treated as matching completion and `Order` remains untouched.

The actual golden file `danh-sach-don-hang-20260917-1415.xlsx` was unavailable in the allowed workspace during Stage 4. Production layout validation is pending an approved real sample; no sheet name, header layout or count of 8 is hard-coded.
