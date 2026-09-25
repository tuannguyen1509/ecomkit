# Authentication (Stage 12A.1)

Stage 12A.1 provides the backend authentication foundation for the shared internal workspace. The only roles are `ADMIN` and `USER`; there is no public registration endpoint.

## Users and passwords

`User` stores a normalized, unique username, display name, role, active flag, and password hash. Passwords must contain at least 10 characters. Passwords use Node.js `crypto.scrypt` with a fresh random 16-byte salt and a 64-byte derived key. Plaintext passwords are never stored.

## Sessions

Login creates an opaque token from `randomBytes(32)`. The browser receives it only in the `ecomkit_session` HttpOnly cookie. PostgreSQL stores only its SHA-256 hash in `Session`, with expiration and last-use timestamps. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and uses `Secure` when `NODE_ENV=production`.

`AUTH_SESSION_TTL_HOURS` defaults to `12`. Expired sessions and sessions belonging to inactive users are rejected (and may be removed lazily during lookup).

## Endpoints

- `POST /api/auth/login` accepts `username` and `password`, sets the session cookie, and returns only safe user fields.
- `GET /api/auth/me` returns the authenticated safe user, or `401`.
- `POST /api/auth/logout` invalidates the current session and clears the cookie.

Login failures use the same `AUTH_INVALID_CREDENTIALS` response for unknown usernames and incorrect passwords.

## Bootstrap first ADMIN

Set `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, and optionally `BOOTSTRAP_ADMIN_DISPLAY_NAME`, then run:

```powershell
npm.cmd run auth:bootstrap-admin --workspace api
```

The command creates an ADMIN only when no ADMIN exists. Re-running it does not create another bootstrap account and never prints the password or hash.

## API guards and Worker principal (Stage 12A.2a)

The API is secure by default: the global authentication guard requires a valid active-user session unless a route explicitly uses `@Public()`. Login and health are public; `/auth/me`, logout, all business APIs, and batch browsing remain protected.

`@Roles(...)` and the RoleGuard are reusable server-side foundations. Roles are loaded from the authenticated database user, never from client input. ADMIN-only user management is deferred to Stage 12B.

The Stage 11 Worker is a separate least-privilege internal principal, not an ADMIN. API and Worker must receive the same non-empty `WORKER_INTERNAL_API_KEY`. The Worker sends it only as `X-Ecomkit-Worker-Key` to the three routes explicitly marked `@AllowInternalWorker()` (Excel parse, PDF parse, and matching). The API compares the key with a constant-time comparison and fails closed when it is missing or invalid.

The Worker key cannot access `/process`, history, result, error, export, auth routes, or future user-management routes. It is never stored in BullMQ; queue jobs remain `{ batchId }`. Do not log or commit the key. Login frontend and ADMIN user-management UI remain Stage 12B work.

## Docker verification (Stage 12A.2b)

The Docker flow was verified with a synthetic batch: a human signs in with the HttpOnly session cookie, uploads Excel and PDF files, and calls only `POST /api/batches/:batchId/process`. BullMQ still receives only `{ batchId }`; the Worker uses its internal principal for Excel, PDF, and matching, and the batch reaches `SUCCESS`. Result, error, history, and XLSX/CSV export remain available to the signed-in human user.

The Worker key alone is rejected from user-facing routes, including process, processing status, history, results, errors, and export. Invalid or missing Worker keys are rejected on internal parser routes. Logout invalidates the session so subsequent `/auth/me` and business API requests are unauthorized.
