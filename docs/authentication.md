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

The Worker key cannot access `/process`, history, result, error, export, auth routes, or user-management routes. It is never stored in BullMQ; queue jobs remain `{ batchId }`. Do not log or commit the key.

## ADMIN user management (Stage 12B.1)

Only an authenticated `ADMIN` can use these backend endpoints:

- `GET /api/admin/users` lists safe user fields only.
- `POST /api/admin/users` creates an `ADMIN` or `USER` using the same password policy and scrypt service as bootstrap.
- `PATCH /api/admin/users/:userId` updates only display name, role, or active state.
- `POST /api/admin/users/:userId/reset-password` replaces the password.

There is no hard-delete endpoint and no public registration endpoint. Usernames are normalized exactly as login usernames and duplicates return `USERNAME_ALREADY_EXISTS`.

Deactivation, role change, and password reset revoke every session for the affected user. Reactivation allows a fresh login only; it does not restore old sessions. An ADMIN cannot deactivate themself or change their own role. The service also prevents an operation that would remove the last active ADMIN (`LAST_ACTIVE_ADMIN_REQUIRED`). Responses never include a password hash, password, session, or token.

## Frontend access (Stage 12B.2)

`/login` is the only unauthenticated frontend route. It signs in with the HttpOnly cookie; no browser token storage is used. The authenticated app shell loads `/api/auth/me` before rendering protected pages, redirects unauthorized sessions to `/login`, and redirects an already authenticated visitor away from `/login`.

The shell provides Dashboard, batch processing, history, result/error pages, export, and logout. ADMIN users also see `/admin/users`; USER users do not see that navigation and the backend still returns `403` for direct access. The ADMIN page uses browser cryptographic randomness to generate a temporary password when requested, keeps it only in component state, and never receives a password from the API response. Deactivation and password reset explain that prior sessions are revoked.

## Docker verification (Stage 12A.2b)

The Docker flow was verified with a synthetic batch: a human signs in with the HttpOnly session cookie, uploads Excel and PDF files, and calls only `POST /api/batches/:batchId/process`. BullMQ still receives only `{ batchId }`; the Worker uses its internal principal for Excel, PDF, and matching, and the batch reaches `SUCCESS`. Result, error, history, and XLSX/CSV export remain available to the signed-in human user.

The Worker key alone is rejected from user-facing routes, including process, processing status, history, results, errors, and export. Invalid or missing Worker keys are rejected on internal parser routes. Logout invalidates the session so subsequent `/auth/me` and business API requests are unauthorized.

## Stage 13A hardening

Login is rate-limited to eight attempts per IP and normalized username per minute. ADMIN credential mutations are rate-limited as well. Browser-session mutations that include an `Origin` header must match `WEB_ORIGIN`; Worker calls remain exempt from browser-Origin validation and retain their least-privilege route allowlist. See [security-hardening.md](security-hardening.md) for operational details and Worker-key rotation.
