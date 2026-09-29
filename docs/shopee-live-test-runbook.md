# Shopee live/test-shop runbook

This runbook prepares Stage 14C.5B. It does not authorize a shop or call Shopee during the readiness gate.

## Verified runtime configuration

| Variable | Secret | Required at generic startup | Required for real Shopee use | Purpose |
| --- | --- | --- | --- | --- |
| `SHOPEE_ENV` | No | No; defaults to `sandbox` | Yes, set explicitly | Exactly `sandbox` or `production`; never inferred from shop/domain IDs. |
| `SHOPEE_PARTNER_ID` | Treat as sensitive configuration | No | Yes | Shopee Open Platform application Partner ID. |
| `SHOPEE_PARTNER_KEY` | Yes | No | Yes | HMAC signing key. Never log or expose it. |
| `SHOPEE_REDIRECT_URI` | No | No | OAuth only | Exact callback URL registered in the Developer Console. |
| `MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY` | Yes | No | OAuth/token persistence | Base64 encoding of exactly 32 random bytes; API and Worker must receive the same value. |
| `SHOPEE_HTTP_TIMEOUT_MS` | No | No | Provider calls | Bounded HTTP timeout; default `30000`. |
| `SHOPEE_OAUTH_STATE_TTL_SECONDS` | No | No | OAuth | Redis state TTL; default `600`. |
| `SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS` | No | No | Token lifecycle | Refresh safety margin; default `300`. |
| `SHOPEE_REFRESH_LOCK_TTL_MS` | No | No | Token lifecycle | Distributed refresh lock TTL; default `30000`. |
| `SHOPEE_INCREMENTAL_OVERLAP_SECONDS` | No | No | Incremental sync | Ecomkit replay overlap, default `300`, allowed `0..3600`. |

Blank Shopee values do not prevent generic API/Worker startup. An actual Shopee operation fails with a bounded safe configuration error. Store production secrets in deployment secret management, not Git, browser storage, Redis, queue payloads, logs, or manually edited database rows.

## Endpoint and callback matrix

| Mode | Authorization | API base |
| --- | --- | --- |
| `sandbox` | `https://open.sandbox.test-stable.shopee.com/auth` | `https://openplatform.sandbox.test-stable.shopee.sg` |
| `production` | `https://open.shopee.com/auth` | `https://partner.shopeemobile.com` |

The callback route implemented by Ecomkit is `GET /api/marketplaces/shopee/oauth/callback`.

- Local configured URI: `http://localhost:3001/api/marketplaces/shopee/oauth/callback`
- Production configured URI: `https://ecom.vuikhoe.vn/api/marketplaces/shopee/oauth/callback`

Production mode rejects a non-HTTPS redirect URI. The production URI must be publicly reachable through the deployment TLS/reverse-proxy layer and must exactly match the Developer Console registration.

## Developer Console checklist

- [ ] Shopee Open Platform application exists — **MUST BE PROVIDED**.
- [ ] Partner ID and Partner Key are available in the deployment secret store — **MUST BE PROVIDED**.
- [ ] Exact HTTPS callback URI/domain is registered — **MUST BE CONFIGURED**.
- [ ] Seller/shop authorization is enabled for the application — **NEEDS CONSOLE VERIFICATION**.
- [ ] Order-read API permissions are approved — exact permission/scope names **NEEDS CONSOLE VERIFICATION**.
- [ ] Correct app type and production approval workflow — **UNVERIFIED / MUST CONFIRM IN DEVELOPER CONSOLE**.
- [ ] Vietnam and any cross-border applicability — **UNVERIFIED / MUST CONFIRM IN DEVELOPER CONSOLE**.
- [ ] Test-shop provisioning and an eligible seller account — **UNVERIFIED / MUST CONFIRM IN DEVELOPER CONSOLE**.

Do not guess scope names or treat a successful login to the console as proof of order API approval.

Readiness status at Stage 14C.5A: application code and local runtime are **READY**; Partner ID, Partner Key, and exact callback registration are **MISSING** from source by design and must come from secret/deployment configuration; app type, approval, order permissions, regional applicability, and test-shop availability **NEED CONSOLE VERIFICATION**.

## Stage 14C.5B live/test-shop procedure

1. Set `SHOPEE_ENV` explicitly to `sandbox` or `production` for the approved application.
2. Set `SHOPEE_PARTNER_ID` and `SHOPEE_PARTNER_KEY` from secret management.
3. Set one Base64 32-byte `MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY` identically for API and Worker; preserve it across restarts.
4. Set `SHOPEE_REDIRECT_URI` to the exact Developer Console callback URI.
5. Confirm Developer Console seller authorization, shop eligibility, and order permissions.
6. Start/recreate the canonical `ecomkit-vuikhoe` API and Worker containers; no additional service is required.
7. Run only secret-free readiness checks: mode validity, presence booleans, encryption-key validity, Redis availability, callback validity, UTC time and Unix seconds. Never print values.
8. Sign in as ADMIN and initiate OAuth through `POST /api/marketplaces/shopee/oauth/start`.
9. Authorize the intended seller/test shop at Shopee. The generated URL contains `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`, and a random state.
10. Allow Shopee to call the public callback with `code`, `shop_id`, and `state`. Ecomkit requires state even if provider documentation treats it as optional.
11. Ecomkit atomically consumes state, exchanges the single-use code, encrypts returned credentials, and activates/reconnects the identified shop.
12. Validate token reuse/refresh and then perform the separately authorized bounded order-sync smoke test.

The authorization code is provider-issued, single-use, and documented as expiring after approximately 10 minutes. Access tokens are approximately 4 hours; refresh tokens approximately 30 days and rotate as single-use credentials. A previous access token may remain valid briefly after rotation, but Ecomkit always persists and uses the newest coherent token pair.

## Clock and signing checks

Shopee signing uses Unix seconds and HMAC-SHA256 lowercase hexadecimal signatures. Containers use the host/container runtime system clock; Ecomkit does not override it and has no mandatory external NTP call. Before live testing, operations must ensure the Docker host clock is synchronized using the operating system's normal time service. A safe diagnostic may display only UTC time and Unix seconds.

## Failure and rollback

- OAuth callback/code failure: restart authorization; never reuse or manually store the code.
- State mismatch, expiry, or replay: reject and restart OAuth. Do not bypass Redis state validation.
- Token exchange failure: retain no plaintext token and retry with a newly issued authorization code.
- `REAUTH_REQUIRED` or revoked authorization: ADMIN repeats OAuth; do not edit encrypted envelopes manually.
- Missing permission: confirm app approval/shop eligibility in Developer Console before retrying.
- Configuration error: correct secret/config injection and recreate only API/Worker; do not delete database rows or volumes.
- Encryption-key loss/mismatch: stop provider operations and restore the correct secret from secret management. Do not generate a replacement while existing envelopes still depend on the old key.

No operator pastes access or refresh tokens into the database or UI. OAuth callback plus the encrypted credential lifecycle is authoritative.
