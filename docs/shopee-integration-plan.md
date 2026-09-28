# Shopee integration plan (Stage 14C.1)

Verification date: 2026-09-28 (Asia/Bangkok).

## Scope and authority

This is an official-document verification and plan only. No Shopee API request, credential, OAuth callback, provider SDK, Prisma/API/Worker/Web change, or package change was made.

Provider facts in this document are verified from the official Shopee Open Platform PDF exports supplied by the project owner: **Authorization & Authentication**, **`v2.order.get_order_list`**, and **`v2.order.get_order_detail`**. No third-party source is used as authority. Stage 6B Golden remains **PENDING** because approved production Excel is unavailable.

## Verified authorization and redirect flow

Shopee seller authorization is valid for up to **365 days**; a seller may select a shorter authorization expiry.

| Environment | Authorization URL |
| --- | --- |
| Production | `https://open.shopee.com/auth` |
| Sandbox | `https://open.sandbox.test-stable.shopee.com/auth` |

Required authorization parameters are `partner_id`, `auth_type=seller`, `redirect_uri`, and `response_type=code`. `state` is optional and officially supported: Shopee returns it unchanged after authorization.

**Shopee-native state support: YES.** Ecomkit must still generate a cryptographically random, single-use, short-lived state, store pending context in Redis, bind it to the initiating ADMIN/session where possible, and validate it before code exchange.

Test/Live Redirect URL Domain configuration is required in the Shopee Console where validation applies. The `redirect_uri` domain must match that configured domain. Ecomkit production therefore needs a stable HTTPS callback domain; no company domain is hard-coded here.

Shop authorization callback fields are `code` and `shop_id`. Main-account authorization may return `code` and `main_account_id`, but Phase 1 is shop-level only. The authorization code is single-use and expires after **10 minutes**.

## App credentials and environments

The verified identifier is `partner_id`; the signing secret is `partner_key`. `partner_key` is secret material. It must be supplied only from local untracked runtime configuration or a production secret manager, never DB plaintext, Git, queue data, logs, Web code, or documentation values.

The official exports identify separate Production and Sandbox hosts. Test/Live App creation, approval/category, exact credential separation, and available test shops still require **Developer Console confirmation**. Proposed future placeholders, subject to that confirmation:

```text
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY=
```

No placeholder was added to `.env.example` in this stage.

## Signing

Verified algorithm: **HMAC-SHA256** using `partner_key`, encoded as a lowercase hexadecimal digest.

For Shop APIs, the base string is the concatenation, in this exact order:

```text
partner_id + api_path + timestamp + access_token + shop_id
```

For Public APIs, the verified base string is:

```text
partner_id + api_path + timestamp
```

Token endpoints must follow their official documented public/common signing rules. The timestamp validity window is **5 minutes**. The supplied documents do not state a distinct GET-versus-POST signature formula; the signed API path and principal type determine the base string.

## Access-token exchange and refresh

| Operation | Production endpoint | Sandbox endpoint |
| --- | --- | --- |
| Get access token | `POST https://partner.shopeemobile.com/api/v2/auth/token/get` | `POST https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/token/get` |
| Refresh access token | `POST https://partner.shopeemobile.com/api/v2/auth/access_token/get` | Requires confirmation from the supplied authorization export before implementation. |

Common token endpoint parameters are `partner_id`, `timestamp`, and `sign`. A shop-level token-exchange body contains `code`, `partner_id`, and `shop_id`.

Verified lifetimes and replacement semantics:

- `access_token`: **4 hours**; reusable while valid.
- After a new access token is generated, the previous access token remains valid for approximately **5 minutes**.
- `refresh_token`: **30 days**, single-use per `shop_id`/`merchant_id`.
- Refresh returns a new access token and a new refresh token; the new refresh token is required for the next refresh.

This confirms the existing Ecomkit design: replace the entire encrypted credential envelope atomically. A refresh failure caused by expiration/authorization invalidation must lead to `REAUTH_REQUIRED`, rather than blind retrying. The exact official refresh request body and sandbox refresh host remain a small verification item for Stage 14C.3.

## Order list

| Item | Verified value |
| --- | --- |
| Endpoint | `GET /api/v2/order/get_order_list` |
| Production host | `https://partner.shopeemobile.com/api/v2/order/get_order_list` |
| Sandbox host | `https://openplatform.sandbox.test-stable.shopee.sg/api/v2/order/get_order_list` |
| Shop authentication | `partner_id`, `timestamp`, `access_token`, `shop_id`, `sign` |
| Time range field | `create_time` or `update_time` |
| Required range | `time_from`, `time_to` |
| Maximum range | `time_to - time_from <= 15 days` |
| Page size | `1..100` |
| Pagination | optional `cursor`; response `more`, `next_cursor` |

If `more=true`, the next request uses the prior `next_cursor`. Supported selectable status values include `UNPAID`, `READY_TO_SHIP`, `PROCESSED`, `SHIPPED`, `COMPLETED`, `IN_CANCEL`, `CANCELLED`, and `INVOICE_PENDING`. Phase 1 must not restrict retrieval to only shipment-ready orders without a later business decision.

Recommended strategy:

- **Initial:** retrieve sequential bounded windows of at most 15 days for an approved larger history range.
- **Incremental:** use `time_range_field=update_time`, committed checkpoint, cursor pagination, and a bounded overlap. The overlap duration is intentionally not selected until production observation.

`MarketplaceSyncRun.startCursor`, `MarketplaceSyncRun.resultCursor`, and `MarketplaceConnection.syncCursor` support this model without schema changes.

## Order detail and normalization

Verified detail endpoint: `GET /api/v2/order/get_order_detail`. It accepts `order_sn_list`, with **1–50 `order_sn` values per request**. Future detail calls must batch at most 50 identifiers.

Verified detail concepts include `order_sn`, `region`, `currency`, `cod`, `total_amount`, `order_status`, `create_time`, `update_time`, `item_list`, `recipient_address`, `payment_method`, and `shipping_carrier`.

Item concepts include `item_id`, `item_name`, `item_sku`, `model_id`, `model_name`, `model_sku`, `model_quantity_purchased`, `model_original_price`, and `model_discounted_price`. Provider fields are optional/source-dependent; missing or masked values remain `NULL` and Ecomkit must not infer buyer data, SKU, prices, or financial output values.

Shopee reports `order_sn` as its unique order identifier. Its canonical Ecomkit mapping is:

```text
order_sn -> marketplaceOrderId -> rawOrderCode -> Mã đơn sàn
```

No identifier transformation, case folding, or fuzzy matching is allowed. `item_list` maps conceptually to `NormalizedMarketplaceOrderItem[]`; `order_status` to `rawProviderStatus`; `create_time` to `providerCreatedAt`; and `update_time` to `providerUpdatedAt`.

Buyer/recipient information may be masked by market, seller, or channel. Ecomkit avoids collecting unnecessary PII and preserves only returned source values when a later approved mapping requires them.

## Errors, retries, permissions, and rate limits

Verified order-response concepts are `request_id`, `error`, and `message`. Verified error classes/examples include `error_not_found`, `error_param`, `error_permission`, `error_server`, `error_network`, `error_data`, `error_shop`, `order.order_list_invalid_time`, and `common.error_auth`.

Future safe mapping:

```text
error       -> MarketplaceSyncError.externalCode
message     -> MarketplaceSyncError.message
request_id  -> MarketplaceSyncError.safeContext.requestId
```

Never store an authorization header, token, `partner_key`, signature, or signed URL in error context.

Planned classification, not runtime behavior: `error_server` and `error_network` are likely retryable; `error_param`, `error_permission`, `error_shop`, and `order.order_list_invalid_time` are non-retryable until corrected; `common.error_auth` requires token/reauthorization handling rather than blind retries.

Exact rate-limit quota and `Retry-After` semantics are **NOT VERIFIED** in the supplied exports. Generic Ecomkit throttling/backoff remains configurable; real tuning belongs to test-shop/production rollout validation.

The intended scope is **read order data only**. Product write, inventory write, price write, and order modification are all **NO**. Exact Shopee Console permission/scopes remain to be confirmed before authorization.

## `shop_id`, Vietnam, and Console items

`shop_id` is the verified shop-level principal used in seller authorization, token exchange, Shop API authentication, and refresh-token single-use scope. For Phase 1, `externalShopId = shop_id`. `main_account_id` is returned in a distinct main-account authorization flow and is deferred.

The supplied exports provide the Production and Sandbox hosts above, but do not independently verify Vietnam-specific enrollment, regional restrictions, or cross-border behavior. The intended marketplace is Shopee Vietnam; this operational applicability requires Developer Console confirmation before real authorization/E2E.

Still requiring Developer Console confirmation:

- App creation/type/category and approval requirements.
- Test/sandbox availability, authorized test shop, and Test-versus-Live credentials.
- Actual Partner credentials and callback-domain registration.
- Exact read-order scopes/permissions.
- Vietnam/local/cross-border applicability and exact rate quota.

These do not block Stage 14C.2 contract-level signing/HTTP-client work, but they block real OAuth and sandbox/test-shop E2E.

## Ecomkit compatibility

| Foundation component | Result |
| --- | --- |
| `MarketplaceConnection` | Compatible: `platform=SHOPEE`, `externalShopId=shop_id`, encrypted shop credentials. |
| `credentialEnvelope` | Compatible: atomic access token, rotating refresh token, expiry metadata, and shop ID payload. |
| `MarketplaceAdapter` / Registry | Compatible with signed auth, exchange, refresh, list, detail, normalization, and safe error mapping. |
| `MarketplaceSyncRun` | Compatible with <=15-day windows and cursor audit. |
| `MarketplaceExternalOrder` | Compatible with unique `order_sn` source identity and provider timestamps. |
| `MarketplaceSyncError` | Compatible with error/message/request ID and retryability without secret leakage. |
| `marketplace-sync` | Compatible with same-run retry, checkpoint-on-success, and configurable throttling. |

**Schema changes required: NO.**
**Generic architecture changes required: NO.**

## Next implementation stages

```text
14C.1  Official API verification + plan
14C.2  Shopee Signing + HTTP Client + Contract Tests
14C.3  Shopee OAuth + Token Lifecycle
14C.4  Order List + Detail + Normalization
14C.5  Sandbox/Test-Shop E2E
14C.6  Shopee regression + closure
```

Manual user functional testing is not required in Stage 14C.1 because this stage adds no user-facing authorization or synchronization function.

## Stage 14C.2 signing and HTTP-client foundation

Stage 14C.2 adds reusable shared `ShopeeSigner`, runtime config loader, and `ShopeeHttpClient`. They use Node built-in `crypto` and native `fetch`; no provider SDK is installed. `SHOPEE_ENV` selects only `sandbox` or `production` and centralizes the official hosts. The configuration is lazy: absent `SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY` does not affect current application startup, but constructing provider functionality with missing/invalid configuration fails with a bounded error.

The signer uses the documented public/token and Shop base strings exactly, with Unix seconds injected through a clock for deterministic tests. The HTTP client serializes query values with `URLSearchParams` after signing raw contract components. It applies a configurable `SHOPEE_HTTP_TIMEOUT_MS` (default 30000), uses injected fake fetch in tests, and performs no real Shopee traffic.

Diagnostics retain only operation, API path, HTTP status, request ID, external code, retryability hint, and a safe message. They never retain or log a full URL/query, partner key, access/refresh token, signature, or credential envelope. Stage 14C.2 implements neither OAuth callback/token persistence nor order list/detail business sync, normalization, or production adapter registration.

## Stage 14C.3A OAuth start and callback foundation

Stage 14C.3A implements only the shop-level OAuth foundation. `POST /api/marketplaces/shopee/oauth/start` is authenticated and ADMIN-only. It lazily validates `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV`, and the new absolute `SHOPEE_REDIRECT_URI`; production redirect URIs require HTTPS. It produces the current official `/auth` URL with `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`, and a cryptographically random base64url state. No key or token is included.

The raw state is never used as a Redis key. A SHA-256 state hash keys a Redis record containing only platform, initiating ADMIN user ID, environment, redirect URI, and creation time. `SHOPEE_OAUTH_STATE_TTL_SECONDS` defaults to 600 seconds, an Ecomkit correlation choice aligned with (but distinct from) Shopee's verified 10-minute authorization-code lifetime. Callback consumption uses one Redis Lua operation (read-and-delete), so a state is single-use; Redis failure prevents both start and token exchange.

`GET /api/marketplaces/shopee/oauth/callback` is public only because Shopee redirects the browser to it. It requires `code`, `shop_id`, and state, consumes and validates the bound state before exchanging the code through the existing signed `ShopeeHttpClient`, and rejects the unsupported Phase-1 `main_account_id`-only flow. Authorization codes, raw state, full authorization URLs, and tokens are not logged or persisted outside the immediate exchange.

The verified token response is validated for `access_token`, `refresh_token`, and positive `expire_in`. It is stored only through `MarketplaceCredentialService` as an AES-256-GCM credential envelope. `tokenExpiresAt` derives from `expire_in`; `refreshTokenExpiresAt` derives from Shopee's documented 30-day validity. No authorization-expiry field is fabricated. The callback creates or atomically reconnects `(SHOPEE, shop_id)`, preserving history and replacing the full envelope before setting `ACTIVE`; an explicit successful ADMIN OAuth flow may reactivate a disabled connection. `shopName` remains null because Shopee authorization does not supply a verified name.

All Stage 14C.3A tests use fake token responses and synthetic markers. They make no Shopee traffic. Token refresh, scheduled lifecycle work, order list/detail retrieval, normalization, queue registration, and UI remain outside this substage.

## Stage 14C.3B on-demand refresh lifecycle

`ShopeeTokenService.ensureValidAccessToken(connectionId)` is internal and reusable by future adapter/Worker code; it has no controller, session, or browser dependency. It uses the encrypted payload only in process memory. A token with more than `SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS` remaining is reused; the default 300 seconds is an Ecomkit safety margin, not a Shopee quota.

When refresh is needed, the service takes an ownership-safe Redis lock at `shopee-refresh-lock-<connectionId>` with a bounded `SHOPEE_REFRESH_LOCK_TTL_MS` default of 30000. The lock contains neither credentials nor envelope, and release is compare-and-delete. After acquiring it, the service reloads and rechecks the envelope before calling the verified `POST /api/v2/auth/access_token/get` endpoint through the existing public/token signer. This protects Shopee's single-use refresh token from concurrent reuse.

The new access and refresh tokens are validated and persisted together as one newly encrypted envelope. Their expirations derive from `expire_in` and Shopee's verified 30-day refresh validity. Expired refresh credentials, credential corruption, or an explicitly classified `common.error_auth` transition the connection to `REAUTH_REQUIRED`; transient HTTP failures retain the prior envelope and `ACTIVE` status. No SyncRun, SyncError, Batch, or ExternalOrder is created. There is no scheduler or public token endpoint.

## Stage 14C.4A order API client

`ShopeeOrderClient` is an internal provider client only. It obtains an in-memory credential from `ShopeeTokenService`, then uses the existing signed HTTP client for `GET /api/v2/order/get_order_list` and `GET /api/v2/order/get_order_detail`. It makes no database writes, queue calls, normalization, Batch creation, or adapter registration.

List windows validate `create_time` or `update_time`, `time_from < time_to`, and the verified maximum of 15 days. A pure splitter produces consecutive no-gap windows for later initial-sync orchestration; incremental callers can use `update_time`. Page size is validated at 1–100 (default 100). Cursor values remain opaque, and the list-all helper rejects missing or repeated next cursors rather than looping indefinitely.

Detail identifiers remain opaque `order_sn` strings. Pure batching preserves caller order and creates sequential batches of at most 50 identifiers. Provider detail results are keyed by `order_sn`, so shuffled results are supported, missing identifiers are surfaced, and duplicate provider details are rejected. Optional/masked fields remain optional/source values. The client does not request PII-specific optional fields by default. Stage 14C.4B will normalize these DTOs and integrate the adapter.
