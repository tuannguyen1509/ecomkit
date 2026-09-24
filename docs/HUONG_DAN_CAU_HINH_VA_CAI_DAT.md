# Hướng dẫn cấu hình và cài đặt — Ecomkit - Vui Khỏe

Tài liệu sống này hướng dẫn một máy mới từ chuẩn bị môi trường đến build, migrate, start và kiểm tra ECOM-KIT. Cập nhật tài liệu này cùng stage khi dependency, Docker runtime, biến môi trường, command hoặc yêu cầu hệ thống thay đổi.

## 1. Cấu hình máy

Máy development chạy full local stack nên có tối thiểu Windows 10/11 64-bit, CPU 4 cores, RAM 8 GB và SSD trống 20 GB. Khuyến nghị Core i5/Ryzen 5 hoặc tương đương, RAM 16 GB+ và SSD/NVMe trống 50 GB+. RAM 8 GB vẫn chạy được, nhưng Windows, Chrome, Excel và Docker cùng lúc có thể chậm.

Máy người dùng sau khi hệ thống deploy lên server chỉ cần browser hiện đại; không cần cài Node.js, npm, PostgreSQL, Redis, Prisma hay Docker.

## 2. Prerequisites

- Docker Desktop trên Windows (hoặc Docker Engine phù hợp) và Docker Compose.
- Git 2.53.0.windows.2 đã được kiểm tra.
- Node.js **24.21.0** và npm **11.12.1** chỉ cần khi chạy npm trực tiếp ngoài Docker. Runtime chuẩn là Node 24, không phải Node 25 host.

PowerShell có thể chặn `npm.ps1` bằng `PSSecurityException`. Không cần đổi execution policy toàn hệ thống; dùng `npm.cmd` và `npx.cmd` thay thế.

PostgreSQL và Redis không cần cài native trên Windows: Docker Compose tạo `ecomkit-postgres`, `ecomkit-redis`, `ecomkit-web`, `ecomkit-api`, `ecomkit-worker`.

## 3. Lấy source và cấu hình environment

Clone source rồi mở terminal tại root:

```powershell
git clone <repository-url>
cd Ecomkit-VuiKhoe
Copy-Item .env.example .env
```

Nếu repository chưa có remote, copy source vào một folder rồi mở terminal tại folder chứa `package.json` và `docker-compose.yml`. Không commit `.env`.

| Variable | Required | Mục đích | Ví dụ an toàn |
| --- | --- | --- | --- |
| `POSTGRES_DB` | Yes | Tên database PostgreSQL | `ecomkit` |
| `POSTGRES_USER` | Yes | User PostgreSQL local | `ecomkit` |
| `POSTGRES_PASSWORD` | Yes | Password PostgreSQL local | `change_me_for_local_development` |
| `POSTGRES_PORT` | Yes | Port nội bộ PostgreSQL | `5432` |
| `DATABASE_URL` | Yes | Prisma/API kết nối PostgreSQL nội bộ Docker | `postgresql://ecomkit:...@postgres:5432/ecomkit` |
| `REDIS_HOST` | Yes | Docker Redis hostname | `redis` |
| `REDIS_PORT` | Yes | Redis port nội bộ | `6379` |
| `REDIS_URL` | Yes | Redis connection URL | `redis://redis:6379` |
| `NODE_ENV` | Yes | Runtime mode | `development` |
| `WEB_PORT` | Yes | Web host port | `3000` |
| `API_PORT` | Yes | API host port | `3001` |
| `NEXT_PUBLIC_API_URL` | Yes | Browser-to-API URL | `http://localhost:3001/api` |
| `UPLOAD_STORAGE_ROOT` | Yes | Root storage trong API container | `/app/storage` |
| `UPLOAD_MAX_FILE_SIZE_MB` | Yes | Giới hạn mỗi upload file | `25` |
| `UPLOAD_MAX_FILES_PER_BATCH` | Yes | Số file tối đa trong Batch | `100` |

## 4. Install, build và Docker commands

Dependencies đã được khai báo trong `package.json` và khóa trong `package-lock.json`; máy mới chỉ chạy:

```powershell
npm.cmd install
docker compose -p ecomkit-vuikhoe up -d --build
```

Không cài từng JS package thủ công. Các command vận hành:

```powershell
docker compose -p ecomkit-vuikhoe ps
docker compose -p ecomkit-vuikhoe logs -f
docker compose -p ecomkit-vuikhoe down
```

Không dùng `docker compose -p ecomkit-vuikhoe down -v` để stop thông thường vì sẽ xóa persistent volume PostgreSQL/Redis.

## 5. Prisma và database

Prisma ORM **7.10.0** chạy với PostgreSQL **16.15** trong Docker. PostgreSQL không expose ra Windows chỉ để migrate. Chạy command qua API container trên `ecomkit-network`:

```powershell
docker compose -p ecomkit-vuikhoe exec api npm run db:validate --workspace database
docker compose -p ecomkit-vuikhoe exec api npm run db:generate --workspace database
docker compose -p ecomkit-vuikhoe exec api npm run db:migrate --workspace database
docker compose -p ecomkit-vuikhoe exec api npm run db:status --workspace database
```

Migration development hiện có là `stage2_core`. Chỉ dùng `db:migrate` khi thực sự tạo migration mới; không dùng `prisma db push` hoặc destructive reset.

## 6. Kiểm tra sau cài đặt

- Frontend: <http://localhost:3000>
- API: <http://localhost:3001/api/health>
- Expected API: `{ "status": "ok", "service": "ecomkit-api" }` (có thể có thêm timestamp).
- PostgreSQL: `docker compose -p ecomkit-vuikhoe exec postgres psql -U ecomkit -d ecomkit -c "SELECT 1;"`
- Redis: `docker compose -p ecomkit-vuikhoe exec redis redis-cli ping` và nhận `PONG`.

Containers phải Running/Healthy theo `docker compose -p ecomkit-vuikhoe ps`.

## 7. File storage và Excel parser

`storage/uploads` chứa upload persisted; `storage/tmp` chỉ chứa upload tạm. Cả hai không lưu payload trong Git; chỉ `.gitkeep` được commit. Không tự xóa storage/volume khi bàn giao.

Stage 4 dùng `exceljs` **4.4.0** trong API để đọc workbook `.xlsx`, worksheet, cell display text, row number và header. Máy mới không cài riêng dependency này: `npm.cmd install` cài theo lockfile. Parser endpoint là `POST /api/batches/:batchId/excel/parse`; test là `docker compose -p ecomkit-vuikhoe exec api npm run test:excel --workspace api`.

Stage 5 dùng `pdfjs-dist` **6.3.289** để đọc PDF theo trang/text items. Package hỗ trợ Node 24, được cài bằng `npm.cmd install`, không cần native executable, system package hay thay đổi Docker image. Endpoint là `POST /api/batches/:batchId/pdfs/parse`; test là `docker compose -p ecomkit-vuikhoe exec api npm run test:pdf --workspace api`.

## 8. Known issues

- Node host 25 không phải runtime chuẩn; project pin Node 24.21.0 và Docker image `node:24.21.0-bookworm-slim`.
- Khi PowerShell chặn `npm.ps1`, dùng `npm.cmd`.
- `npm audit` hiện có 6 warnings: 4 high trong dependency gián tiếp Prisma CLI (`deepmerge-ts`, `mysql2`) và 2 moderate từ `exceljs` dependency `uuid`. Không dùng `npm audit fix --force`: hiện command đề xuất downgrade breaking Prisma hoặc ExcelJS. Không nâng Prisma lên RC chỉ để giảm audit warning.

# Dependency / Environment Change Log

| Stage | Component | Version | Purpose | Máy mới cần cài riêng? |
| ----- | --------- | ------- | ------- | ---------------------- |
| 0 | Docker host | 29.8.0 | Container runtime đã test | Có |
| 0 | Docker Compose | v5.5.1 | Orchestrate local stack | Có cùng Docker Desktop/Engine |
| 0 | Git | 2.53.0.windows.2 | Source control | Có |
| 1 | Node.js runtime | 24.21.0 | Runtime chuẩn, Docker base `node:24.21.0-bookworm-slim` | Có nếu chạy npm ngoài Docker |
| 1 | npm | 11.12.1 | Package manager | Đi kèm Node |
| 1 | Next.js | 16.3.6 | Web application | Không, `npm install` |
| 1 | React | 19.3.0 | Web UI runtime | Không, `npm install` |
| 1 | NestJS | 12.1.0 | API runtime | Không, `npm install` |
| 1 | TypeScript | 5.9.3 | Type checking/build | Không, `npm install` |
| 0 | PostgreSQL | 16.15 | Docker database image | Không |
| 0 | Redis | 7.4.11 | Docker queue/cache image | Không |
| 2 | Prisma ORM | 7.10.0 | PostgreSQL ORM/migration | Không, `npm install` |
| 3 | Multer / adm-zip | 2.x / 0.6.1 | Safe upload and XLSX container validation | Không, `npm install` |
| 4 | exceljs | 4.4.0 | Read `.xlsx` workbook, worksheet, cells and displayed text | Không, `npm install` |
| 5 | pdfjs-dist | 6.3.289 | Read PDF pages, text and text-item coordinates | Không, `npm install`; no OS dependency |
| 6 | Matching Engine | No new runtime/system dependency | Normalize and match persisted parsed candidates | Không |
| 7 | Result UI | No new runtime/system dependency | Read-only Batch result API and Next.js result screen | Không |
| 8 | Error Management UI | No new runtime/system dependency | Read-only ProcessingError API and UI | Không |
