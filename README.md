# Ecomkit - Vui Khỏe

Hệ thống nội bộ xử lý, đối soát và đồng bộ đơn hàng thương mại điện tử của Vui Khỏe / N.K.Luck Việt Nam.

Ecomkit tiếp nhận dữ liệu từ Excel, PDF và Marketplace API, chuẩn hóa về một luồng xử lý chung rồi cung cấp kết quả, lỗi, lịch sử và file xuất. Hệ thống hiện có nền tảng cho Shopee và Lazada; TikTok Shop và Google Sheets vẫn thuộc roadmap. Trạng thái “đã triển khai” trong tài liệu này không đồng nghĩa đã hoàn tất nghiệm thu với dữ liệu production.

Xem [ECOMKIT_PROJECT_HANDOFF.md](ECOMKIT_PROJECT_HANDOFF.md) để biết checkpoint và lịch sử triển khai chi tiết.

## Luồng nghiệp vụ chính

```text
Upload / Marketplace API
  → Validate
  → Parse / Fetch
  → Normalize
  → Match theo Mã đơn sàn
  → MarketplaceExternalOrder (khi nguồn là Marketplace)
  → Batch
  → Order / OrderItem
  → Result / Error / History
  → Export XLSX / CSV
```

Khóa đối soát duy nhất là **Mã đơn sàn**. Không ghép đơn bằng tên, số điện thoại, địa chỉ hoặc sản phẩm.

## Kiến trúc tổng quan

```text
Browser → Next.js Web → NestJS API → PostgreSQL
                         ↓
                       BullMQ → Worker
                         ↕
                       Redis

API / Worker → marketplace-server → Shopee hoặc Lazada
```

Web không giữ provider credential. API xử lý auth và nghiệp vụ tương tác; Worker thực thi các job nền. `marketplace-server` chứa phần tích hợp server-only dùng chung giữa hai runtime.

## Chức năng hiện có

### Xử lý file

- Nhận `.xlsx` và `.pdf`, kiểm tra định dạng/chữ ký file và lưu an toàn.
- Parse dữ liệu, chuẩn hóa mã đơn sàn, đối soát và tạo Batch/Order/OrderItem.
- Quản lý lỗi có ngữ cảnh khi dữ liệu cung cấp được: nguồn, tên file, sàn, stage, sheet/dòng/cột, trang PDF, error code, giá trị raw an toàn và gợi ý sửa.
- Result, Error Management, History và xuất XLSX/CSV.
- Giới hạn hiện tại: tối đa 25 MB/file, 100 file/Batch và một file Excel/Batch.
- PDF không có text layer sẽ trả lỗi rõ ràng; MVP chưa hỗ trợ OCR.

### Xác thực và phân quyền

- Session-based authentication, route được bảo vệ và kiểm tra trusted origin cho browser mutation.
- `ADMIN`: chức năng vận hành, cấu hình Marketplace, quản lý tài khoản và cấu hình thương hiệu.
- `USER`: chức năng vận hành được cho phép; không có quyền cấu hình Marketplace, quản lý người dùng hoặc branding.
- ADMIN có thể đổi logo, tên ứng dụng và tên phụ. Mặc định là **Ecomkit** / **Vui Khỏe**.

### Queue và Worker

- BullMQ với hai queue hiện hành: `batch-processing` và `marketplace-sync`.
- PostgreSQL lưu nghiệp vụ; Redis phục vụ queue, coordination, OAuth state và distributed lock.
- Queue payload không chứa provider secret hoặc access/refresh token.

### Kiến trúc Marketplace

Kiến trúc provider-neutral, hỗ trợ nhiều shop theo connection và dùng chung pipeline. Các model chính gồm `MarketplaceConnection`, `MarketplaceSyncRun`, `MarketplaceExternalOrder` và `MarketplaceSyncError`. Provider được đóng gói sau `MarketplaceAdapter`; Worker generic chịu trách nhiệm persistence, Batch bridge và retry orchestration.

## Trạng thái Marketplace

### Shopee

Đã triển khai official signing, OAuth foundation, token-refresh lifecycle, Order APIs, normalizer, `MarketplaceAdapter`, production registry, registered synthetic E2E, ADMIN configuration UI, external read-only token mode và mã hóa credential.

Luồng OAuth-managed dành cho ADMIN: lưu cấu hình ứng dụng Shopee → chọn **Kết nối Shopee** → ủy quyền shop trên Shopee → Ecomkit tự nhận Shop ID, đổi authorization code lấy Access/Refresh Token và lưu credential đã mã hóa ở server. UI chỉ hiển thị Shop ID, thời điểm hết hạn và trạng thái “Đã lưu an toàn”; không yêu cầu sao chép hoặc hiển thị token thô. Việc ủy quyền thật vẫn phụ thuộc Redirect URI/approval trong Shopee Developer Console.

Trạng thái hiện tại: **`VALIDATION_PENDING`**

Acceptance gate: **`SHOPEE_LEGACY_DATA_MATCH = PENDING`**

Shopee đã qua synthetic/internal tests nhưng chưa được gọi là production-validated. Nghiệm thu cần so sánh chính xác tập `order_sn` giữa Ecomkit và hệ thống công ty hiện hữu với cùng shop, time window, timezone và status filter. Tổng số bằng nhau nhưng tập mã đơn khác nhau vẫn là FAIL.

### Lazada

Đã triển khai kiểm chứng yêu cầu API chính thức, HMAC-SHA256 signer, HTTP client, OAuth/token acquisition foundation, refresh lifecycle, OrderClient, contract/fixture, normalizer, INITIAL-only `MarketplaceAdapter`, production registry, registered synthetic E2E, ADMIN provider configuration và external read-only token mode.

- Stage 14D.6A: **AUTOMATED PASS / MANUAL_REQUIRED**
- `LAZADA_LEGACY_DATA_MATCH = PENDING`
- Phát triển Lazada hiện **PAUSED** để ưu tiên lại Shopee.
- Incremental sync: **DEFERRED / NOT READY**. Chưa có đủ bằng chứng rằng mọi thay đổi item status đều làm tăng `order.updated_at`, nên không có durable incremental checkpoint.

### TikTok Shop

**NOT STARTED.** Kiến trúc cho phép bổ sung một provider adapter khác trong tương lai, nhưng chưa có implementation.

### Google Sheets

**PLANNED / NOT IMPLEMENTED.** Thiết kế backlog gồm Spreadsheet ID/URL cấu hình được, tab tháng dạng `T{MM}`, fallback tab, audit-log tab, cột mã đơn và field-to-column mapping tùy chỉnh, cùng service-account credential được mã hóa.

## Bảng trạng thái

| Khu vực | Trạng thái |
| --- | --- |
| Excel/PDF pipeline | PASS |
| Auth/Admin | PASS |
| Result/Error/History/Export | PASS |
| Queue/Worker | PASS |
| Marketplace architecture | PASS |
| Shopee synthetic integration | PASS |
| Shopee live validation | PENDING |
| Lazada synthetic INITIAL | PASS |
| Lazada manual/live validation | PENDING / PAUSED |
| Lazada incremental | DEFERRED |
| TikTok Shop | NOT STARTED |
| Google Sheets | PLANNED |

## Công nghệ

- Frontend: Next.js 16, React 19, TypeScript.
- API: NestJS 12, TypeScript.
- Database/ORM: PostgreSQL 16, Prisma 7.
- Queue/coordination: BullMQ 5 và Redis 7.
- Runtime chuẩn: Node.js 24.21.0.
- Container: Docker Compose.

Các phiên bản chính được xác định từ `package.json`, Dockerfiles và Compose; lockfile là nguồn chính xác cho dependency đã cài.

## Cấu trúc repository

```text
api/                 NestJS API, auth, file pipeline và ADMIN endpoints
database/            Prisma schema, migrations và database package
marketplace-server/  Signer, lifecycle, OrderClient, normalizer và adapters
shared/              Contract/helper dùng chung phía server
worker/              BullMQ workers và marketplace runtime registry
web/                 Next.js UI
docker/              Dockerfiles cho từng runtime
docs/                Tài liệu kiến trúc và vận hành chi tiết
storage/             File upload local (runtime data, không phải source)
docker-compose.yml   Canonical local stack
```

## Cài đặt local trên Windows 10/11

Yêu cầu: Git và Docker Desktop có Docker Compose. Node.js/npm chỉ cần khi chạy lệnh trực tiếp ngoài container; khi đó dùng Node 24.21.0 theo `.node-version`/`.nvmrc`.

```powershell
cd C:\Users\nkluck\ecomkit
git checkout vuikhoe
Copy-Item .env.example .env
```

Điền secret local trong `.env`; không commit file này. Sau đó:

```powershell
docker compose -p ecomkit-vuikhoe up -d --build
docker compose -p ecomkit-vuikhoe exec api sh -lc 'cd /app/database && npx prisma migrate deploy --config prisma.config.ts'
docker compose -p ecomkit-vuikhoe exec api npm run auth:bootstrap-admin --workspace api
docker compose -p ecomkit-vuikhoe ps
```

Bootstrap ADMIN cần `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` và tùy chọn `BOOTSTRAP_ADMIN_DISPLAY_NAME` trong `.env`. Chỉ chạy bootstrap theo nhu cầu khởi tạo/quản trị tài khoản.

Địa chỉ local:

- Web: <http://localhost:3000>
- API health: <http://localhost:3001/api/health>
- Các route UI: `/login`, `/batches/new`, `/marketplaces`, `/history`, `/admin/users`, `/admin/settings/branding`.

Canonical Compose project là `ecomkit-vuikhoe`; service/container gồm `web`/`ecomkit-web`, `api`/`ecomkit-api`, `worker`/`ecomkit-worker`, `postgres`/`ecomkit-postgres`, và `redis`/`ecomkit-redis`.

## Biến môi trường

Sao chép từ `.env.example`; dưới đây chỉ là tên/nhóm, không phải giá trị thật:

- Database: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`.
- Redis/queue: `REDIS_HOST`, `REDIS_PORT`, `REDIS_URL`, `QUEUE_BATCH_PROCESSING_NAME`, `MARKETPLACE_SYNC_QUEUE_NAME`, `MARKETPLACE_SYNC_CONCURRENCY`, `MARKETPLACE_SYNC_LOCK_TTL_MS`.
- Web/API: `NODE_ENV`, `WEB_PORT`, `API_PORT`, `NEXT_PUBLIC_API_URL`, `WEB_ORIGIN`, `API_INTERNAL_URL`, `INTERNAL_API_TIMEOUT_MS`.
- Auth/internal: `AUTH_SESSION_TTL_HOURS`, `WORKER_INTERNAL_API_KEY`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_DISPLAY_NAME`.
- Upload: `UPLOAD_STORAGE_ROOT`, `UPLOAD_MAX_FILE_SIZE_MB`, `UPLOAD_MAX_FILES_PER_BATCH`.
- Marketplace crypto: `MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY`.
- Shopee: `SHOPEE_ENV`, `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REDIRECT_URI`, `SHOPEE_HTTP_TIMEOUT_MS`, `SHOPEE_OAUTH_STATE_TTL_SECONDS`, `SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS`, `SHOPEE_REFRESH_LOCK_TTL_MS`, `SHOPEE_INCREMENTAL_OVERLAP_SECONDS`.

Lazada production registry lấy App Key/App Secret từ ADMIN provider configuration đã mã hóa trong database. Một số lifecycle adapter có hỗ trợ tên runtime `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`, `LAZADA_HTTP_TIMEOUT_MS`, `LAZADA_ACCESS_TOKEN_REFRESH_SKEW_SECONDS`, `LAZADA_REFRESH_LOCK_TTL_MS`; các biến này hiện không nằm trong canonical `.env.example`/Compose và không nên được xem là quy trình cấu hình local chính thức.

## Bảo mật credential

- Không commit Partner Key, App Secret, Access Token, Refresh Token, encryption key hoặc mật khẩu tạm.
- Provider secret/token lưu trong DB phải ở dạng AES-256-GCM versioned envelope và không được GET API trả lại sau khi lưu.
- `MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY` là Base64 của đúng 32 byte ngẫu nhiên, chỉ ở server runtime. API và Worker phải nhận cùng một key để đọc cùng credential.
- Secret không được đưa vào queue payload, lock key, log, export hoặc error response.
- External read-only mode dành cho credential do hệ thống khác quản lý: chỉ nhập Access Token/expiry cần thiết, `RefreshOwnership=EXTERNAL`, không tự refresh, revoke, OAuth reconnect, polling hoặc load test. Live test phải hẹp và chỉ đọc.

## Export

XLSX và CSV dùng 24 cột canonical, một Order trên mỗi dòng. Giá trị `NULL` xuất thành ô trống. CSV có UTF-8 BOM và escape các giá trị mở đầu bằng `=`, `+`, `-`, `@` để hạn chế formula injection. Export không tự tính các trường tài chính chưa có nguồn dữ liệu được phê duyệt.

## Lệnh phát triển hữu ích

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run db:validate
npm.cmd run db:status
```

Ưu tiên chạy stack chuẩn bằng Docker. `npm.cmd` được dùng trên Windows PowerShell để tránh execution-policy chặn `npm.ps1`.

## Troubleshooting

Kiểm tra service và log:

```powershell
docker compose -p ecomkit-vuikhoe ps
docker compose -p ecomkit-vuikhoe logs api
docker compose -p ecomkit-vuikhoe logs worker
docker compose -p ecomkit-vuikhoe logs web
docker compose -p ecomkit-vuikhoe exec api npm run db:status --workspace database
```

- Web không vào được: kiểm tra `ecomkit-web`, `ecomkit-api`, `WEB_PORT`, `NEXT_PUBLIC_API_URL` và API health.
- API unhealthy: kiểm tra PostgreSQL/Redis health, `DATABASE_URL`, `REDIS_URL` và API log.
- Marketplace báo thiếu cấu hình: xác nhận encryption key hợp lệ ở cả API/Worker, sau đó lưu lại provider config bằng ADMIN UI. Không cố khôi phục secret plaintext từ GET.
- External token hết hạn: lấy Access Token mới từ hệ thống đang sở hữu token; không nhập hay dùng refresh token của hệ thống đó trong Ecomkit.
- Dừng stack an toàn bằng `docker compose -p ecomkit-vuikhoe down`. Không dùng `down -v` như thao tác thông thường vì sẽ xóa volume dữ liệu.

Không dùng `git reset --hard`, `git clean -fd`, `docker system prune` hoặc force-push như cách xử lý sự cố thông thường.

## Ưu tiên hiện tại

1. Tiếp tục Stage 14C.6B của Shopee.
2. Thực hiện live read-only validation khi Shopee Developer approval/credential hợp lệ sẵn sàng.
3. So sánh chính xác tập `order_sn` với legacy system trong cùng shop/window/timezone/status filter.
4. Chỉ đặt `SHOPEE_LEGACY_DATA_MATCH = PASS` khi missing và extra đều bằng 0.
5. Giữ Lazada ở checkpoint 14D.6A; không phát triển tiếp trong lúc ưu tiên Shopee.
6. Chỉ bắt đầu TikTok sau khi thứ tự ưu tiên Marketplace được phê duyệt.

## Giới hạn đã biết

- Shopee live validation và exact legacy match còn pending; approval bên ngoài có thể là blocker.
- Lazada manual/live validation còn pending và đang paused; incremental checkpoint chưa được phê duyệt.
- PDF scan không có text layer chưa được OCR trong MVP.
- Rate limit/quota Marketplace có thể phụ thuộc app/account/provider console; không hardcode giả định chưa được xác minh.
- Stage 6B Golden vẫn `PENDING` do chưa có production Excel sample được phê duyệt.

Nhánh làm việc chính hiện tại là `vuikhoe`. Không commit secret local và không force-push workflow chia sẻ.
