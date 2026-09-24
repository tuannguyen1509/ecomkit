# Ecomkit - Vui Khỏe

ECOM-KIT is a Docker-first monorepo foundation for processing and reconciling orders across platforms.

## Current architecture

```text
Browser
   ↓
Next.js Web
   ↓
NestJS API
   ↓
PostgreSQL

API / Worker
   ↓
Redis
```

Stage 1 provides application foundations only. It contains no business logic, Prisma schema, migrations, authentication, parsers, integrations, or business UI.

## Requirements

- Docker with Docker Compose
- Node.js 24.21.0 LTS for local commands
- npm
- Git

The repository pins the intended runtime in `.node-version` and `.nvmrc`. The Dockerfiles use `node:24.21.0-bookworm-slim`.

## Configure environment

```powershell
Copy-Item .env.example .env
```

`.env` is ignored by Git. Never commit real passwords or tokens.

## Start

```powershell
npm install
docker compose -p ecomkit-vuikhoe up -d --build
```

## Status

```powershell
docker compose -p ecomkit-vuikhoe ps
```

## Logs

```powershell
docker compose -p ecomkit-vuikhoe logs -f
```

## Stop

```powershell
docker compose -p ecomkit-vuikhoe down
```

This keeps the named PostgreSQL and Redis volumes. Do not use `docker compose down -v` as a normal stop command because it is destructive and removes persistent data.

## Development commands

```powershell
npm run dev:web
npm run dev:api
npm run dev:worker
npm run typecheck
npm run build
npm test
```

## Foundation endpoints

- Web: http://localhost:3000
- API health: http://localhost:3001/api/health

The API health endpoint reports only API process health. It does not claim database or Redis health until those real checks are implemented in a later stage.

## Stage 2 boundary

Prisma setup, database schema, migrations, business tables, parsers, authentication, integrations, and production deployment are intentionally deferred to later stages.

Stage 2 now includes the PostgreSQL core schema and Prisma 7 database package. See [docs/database.md](docs/database.md) for models, migration commands, and data rules.

Stage 3 adds Batch creation and safe file ingestion. See [docs/file-ingestion.md](docs/file-ingestion.md). Stage 3 stores `.xlsx` and `.pdf` files only; it does not parse their contents.

Stage 4 adds technical `.xlsx` parsing into `UploadedFile.rawData` and `ProcessingError`; it does not create Orders or perform matching. See [docs/excel-parser.md](docs/excel-parser.md) and the complete [configuration and installation guide](docs/HUONG_DAN_CAU_HINH_VA_CAI_DAT.md).

Stage 5 adds generic page-level PDF parsing with conservative platform detection. Shopee/SPX support is validated only against the approved local sample; Lazada and TikTok production layouts remain pending. See [docs/pdf-parser.md](docs/pdf-parser.md).
