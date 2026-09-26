# Security and reliability hardening (Stage 13A)

## Threat model

This internal application protects against brute-force login, session and privilege misuse, Worker-key misuse, malformed or oversized uploads, path traversal, raw error/secret leakage, queue replay, and duplicate processing. It is not a multi-tenant system; authenticated ADMIN and USER accounts share the workspace.

## Request and session controls

- `POST /api/auth/login` permits eight attempts per IP plus normalized username per minute, then returns `429 AUTH_RATE_LIMITED`.
- ADMIN create/reset-password mutations and batch queue requests are rate-limited (ten and twenty requests per minute respectively). The in-memory limiter is intentional for the current single-API-instance MVP; distributed rate limiting is a future scaling concern.
- Browser-session mutations with an `Origin` header must match `WEB_ORIGIN`. Requests without an Origin remain available for trusted local operational tooling. The Worker principal bypasses browser Origin validation but is still restricted to its three internal parser routes.
- JSON and URL-encoded request bodies are limited to 1 MB. Multipart upload limits remain 25 MB per file, 100 files per batch, and exactly one Excel file.
- Sessions are opaque, hashed in PostgreSQL, expire after `AUTH_SESSION_TTL_HOURS` (12 by default), and are revoked on logout, password reset, role change, or deactivation.

## Queue safety

The Worker treats deterministic parser/business failures as BullMQ `UnrecoverableError` values. Missing required Excel headers and equivalent 4xx processing failures therefore fail after one attempt. Network, timeout, and server failures remain retryable with the Stage 11 policy (two attempts and exponential 1-second backoff). The queue payload remains only `{ batchId }`.

## Data, secrets, and network boundaries

Uploads are stored under the configured storage root with generated UUID filenames. Original names are sanitized before persistence/display, and XLSX/PDF signatures/containers are validated before parsing. CSV export formula escaping and result/history/error pagination limits are retained from earlier stages.

Do not log passwords, cookies, session tokens, Worker keys, token/password hashes, or `DATABASE_URL`. `WORKER_INTERNAL_API_KEY` belongs only in the runtime environment of API and Worker; rotate it by generating a replacement, updating both environments, recreating both containers, and verifying one queue job.

The Compose API and Web services publish local development ports. PostgreSQL and Redis remain internal to the Compose network. The development images currently run as root because API/Worker use a host-mounted storage directory and `tsx watch`; moving production images to a non-root runtime user requires a storage ownership deployment check before enabling it.

## Residual risks

- SameSite=Lax plus trusted-Origin checking is the current CSRF posture. A full CSRF-token design is a future hardening item if cross-site embedding or broader browser integrations are introduced.
- The current npm audit has transitive findings whose offered remedies are breaking major downgrades/upgrades; Stage 13A does not apply forced dependency changes.
- Stage 6B production Golden validation remains pending because no approved production Excel sample is available.

## Production readiness checklist

Before deployment, provide a production-only environment file with strong PostgreSQL credentials, a new `WORKER_INTERNAL_API_KEY`, the exact HTTPS `WEB_ORIGIN`, `NODE_ENV=production`, and a production `DATABASE_URL`. Use persistent storage and backups for PostgreSQL and uploaded files; place the Web/API services behind a reverse proxy with a domain, DNS, and TLS. Apply Prisma migrations, assign ownership of the active ADMIN account, and run the documented login, upload, queue, result, error, and export smoke tests after deployment.

Recommended follow-up work is a non-root production container layout after verifying storage ownership, a distributed rate limiter before horizontal API scaling, scheduled dependency-major upgrades, and external monitoring/backup verification. Marketplace integrations (Shopee, Lazada, TikTok Shop, and Google Sheets automation) are separate product work and are not part of this hardening stage.
