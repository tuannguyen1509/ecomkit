# PDF Parser — Stage 5

Stage 5 provides generic, synchronous PDF text extraction by `pdfjs-dist` 6.3.289. The engine reads one uploaded PDF at a time into page records containing page number, readable text, and normalized text items (`text`, `x`, `y`, `width`, `height`). No binary PDF is saved in PostgreSQL.

`POST /api/batches/:batchId/pdfs/parse` parses every PDF owned by that Batch sequentially. A file failure does not stop later files. `rawText` holds concatenated readable page text; `rawStructure` holds page-level text/items/status; `rawData` holds parser version, platform evidence and candidate orders. No `Order` or `OrderItem` is created.

Document read failure creates `PDF_READ_ERROR` and file status `ERROR`. A page extraction failure creates `PDF_PAGE_ERROR`, continues other pages and produces `WARNING` when usable pages remain. A PDF with no text layer creates `PDF_PARSE_ERROR` with the OCR-not-supported message; OCR, cloud APIs, external binaries and macros are not used.

Platform detection never uses filename. It currently recognizes literal `SPX` in text as Shopee evidence only because this was observed in the approved local SPX sample. The Shopee provider extracts the observed 14-character SPX candidate shape and records source page; it is limited to that validated sample family. Lazada and TikTok classes are safe skeletons pending text-based real samples. Unknown evidence remains `UNKNOWN` and creates `UNKNOWN_PLATFORM` warning.

Reparse deletes only this file's PDF-generated errors (`PDF_*` and `UNKNOWN_PLATFORM`) before updating its raw fields/status. Excel errors and other files are not affected. `pdfjs-dist` is a JavaScript dependency installed by `npm install`; Node 24 is supported and no extra OS-level PDF dependency or Dockerfile change is required.
