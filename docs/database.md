# Stage 2 — Database + Prisma Core

## Stack

- PostgreSQL 16
- Prisma ORM 7.10.0
- Prisma `prisma-client` generator with output in `database/generated/prisma`
- PostgreSQL driver adapter: `@prisma/adapter-pg`
- Money and percentage values use PostgreSQL `Decimal`; business calculations are not implemented in Stage 2.

The database package loads the root `.env` through `database/prisma.config.ts`. Credentials are never hard-coded. PostgreSQL remains private to `ecomkit-network`; Prisma commands run through a container attached to that network.

## Core models

- `Batch`: one processing run containing one Excel file and zero or more PDFs.
- `UploadedFile`: source file metadata and future raw persistence fields.
- `Order`: one row per order, including the 24 prepared output fields.
- `OrderItem`: product rows belonging to an order.
- `ProcessingLog`: contextual processing messages.
- `ProcessingError`: structured errors with source location and impact fields.

Relations use cascade delete from `Batch` to its child records and from `Order` to `OrderItem`. Optional error/log references to files and orders use `SET NULL`. Stage 2 does not provide a delete API.

## Enums

`FileType`, `Platform`, `ProcessingStatus`, `MatchingStatus`, `Severity`, and `ProcessingLogLevel` are defined in `database/prisma/schema.prisma`.

`Order.normalized_order_code` is deliberately not unique. Duplicate order codes are valid input that a later matching stage must detect. A `(batch_id, normalized_order_code)` non-unique index supports lookup without blocking duplicates.

Business fields are nullable when source data is absent. Missing data is not represented by a fake financial zero. Raw source fields are retained separately from normalized fields.

## Prisma commands

The following commands run through the API image and do not require exposing PostgreSQL to Windows:

```powershell
$repoPath = (Get-Location).Path
docker compose -p ecomkit-vuikhoe run --rm -T -v "${repoPath}:/app" api npm run db:format --workspace database
docker compose -p ecomkit-vuikhoe run --rm -T -v "${repoPath}:/app" api npm run db:validate --workspace database
docker compose -p ecomkit-vuikhoe run --rm -T -v "${repoPath}:/app" api npm run db:generate --workspace database
docker compose -p ecomkit-vuikhoe run --rm -T -v "${repoPath}:/app" api npm run db:migrate --workspace database
docker compose -p ecomkit-vuikhoe run --rm -T -v "${repoPath}:/app" api npm run db:status --workspace database
docker compose -p ecomkit-vuikhoe exec -T api npm run db:smoke --workspace database
```

The first migration is `stage2_core` and is stored under `database/prisma/migrations/`. Do not use `prisma db push` or `prisma migrate reset` for normal development.

## Smoke test scope

`database/src/smoke-test.ts` creates only records marked with `STAGE2_TEST_`, verifies relations, Decimal values, duplicate order codes, nullable business fields, and Batch updates, then deletes only its own Batch so cascading cleanup can be verified.
