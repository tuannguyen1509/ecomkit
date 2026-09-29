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

## Stage 14C.4B.1A.1 server-only workspace scaffold

The cross-runtime credential refactor is split deliberately. `@ecomkit/marketplace-server` is a Node/server-only workspace consumed only by API and Worker build graphs; Web does not import it. This substage adds no lifecycle code or runtime behavior. It establishes workspace and Docker build support for the following lifecycle-contract extraction, with Worker runtime wiring explicitly deferred.

## Stage 14C.4B.1A.2 lifecycle contracts

The server-only package now defines provider-neutral connection repository, credential crypto, distributed-lock, and clock contracts, plus Shopee credential/refresh and trusted-access DTOs. It also defines safe lifecycle domain errors with bounded codes, retryability, optional request ID, and explicit safe serialization. Production lifecycle behavior remains API-owned until 14C.4B.1A.3; no Prisma, Redis, HTTP, API, or Worker adapter has moved.

## Stage 14C.4B.1A.3a inactive lifecycle core

`@ecomkit/marketplace-server` now contains `ShopeeCredentialLifecycle`, a server-only, dependency-injected implementation of the Stage 14C.3B lifecycle. It validates connection state and encrypted credential identity, applies the configured refresh skew, takes the provider-neutral `shopee-refresh-lock-<connectionId>` lock, reloads after acquisition, validates refresh responses, rotates both tokens atomically through its repository contract, and marks expired refresh credentials as `REAUTH_REQUIRED`. Its focused fake-dependency parity tests cover valid reuse, rotation, post-lock reload, bounded lock contention, transient and persistence failure, malformed responses, connection-state validation, and safe errors.

This is a controlled migration step only: the core is intentionally unconnected to API or Worker runtime. The existing API `ShopeeTokenService` remains the sole active implementation until Stage 14C.4B.1A.3b. Temporary duplicate source logic therefore exists, but duplicate active runtime lifecycle logic does not. No Prisma, Redis, HTTP, Docker, adapter, queue, or order flow changed in this substage.

## Stage 14C.4B.1A.3b API lifecycle cutover

The API now supplies Prisma connection-repository, credential-crypto, Redis distributed-lock, and Shopee refresh-client adapters to the server-only `ShopeeCredentialLifecycle`. `ShopeeTokenService` is reduced to a lazy Nest facade: it assembles the infrastructure, delegates `ensureValidAccessToken`, translates safe domain errors to the established API errors, and closes its Redis client. It no longer owns expiry checks, token rotation, credential writes, Redis lock orchestration, provider requests, or shop identity validation. The core preserves the prior bounded lock-contention behavior (10 reload attempts at 50ms) before reporting a refresh-in-progress error.

The AES-256-GCM envelope and Shopee credential payload stay unchanged, so OAuth-created credentials remain readable and refresh-created credentials remain readable by the existing credential service. The API is now the sole runtime consumer of the core; Worker lifecycle reuse and provider-neutral adapter context remain intentionally deferred to Stage 14C.4B.1B.

## Stage 14C.4B.1B.1 credential-free generic adapter context

The generic `MarketplaceAdapter` execution boundary now receives `MarketplaceAdapterContext` containing only `connectionId`, `platform`, `externalShopId`, and `syncRunId`. It contains no credential envelope, access token, refresh token, or provider secret. The generic `marketplace-sync` Worker builds this identity context and no longer decrypts `MarketplaceConnection.credentialEnvelope` or performs provider credential validation before invoking an adapter. Provider-specific adapters will own their credential resolution in a later stage.

The mock adapter accepts the same provider-neutral context and preserves the existing success, replay, update, empty, retry, and restart behavior. Shopee lifecycle wiring in Worker remains deliberately deferred to Stage 14C.4B.1B.2; no Shopee adapter or provider request is registered here.

## Stage 14C.4B.1B.2 Worker lifecycle wiring

Worker now has Prisma repository, shared AES-256-GCM credential crypto, ownership-safe Redis lock, and Shopee HTTP refresh-client adapters for the same server-only `ShopeeCredentialLifecycle` used by API. Its lock namespace is exactly `shopee-refresh-lock-<connectionId>` and it has no API HTTP dependency. Config and Shopee HTTP construction remain lazy, so generic Worker startup does not require Shopee credentials.

Focused Worker integration tests use synthetic credentials and fake refresh transport to verify envelope compatibility, rotation, expired refresh reauthorization, isolated Redis-unavailable handling, and API-style/Worker-style concurrent refresh against the same PostgreSQL and Redis. Exactly one fake provider refresh occurs and both callers receive the rotated access token. Generic `marketplace-sync` remains credential-free; a Shopee adapter and order calls remain deferred to Stage 14C.4B.2.

## Stage 14C.4B.2A.1 shared order-client core

`ShopeeOrderClientCore` now lives in `@ecomkit/marketplace-server`. It uses injected trusted access-credential and order-transport boundaries, with no Nest, API, Worker, direct fetch, signing, or Partner Key dependency. It validates and splits <=15-day windows, keeps cursors opaque, detects invalid/repeated pagination, deduplicates exact `order_sn` values, batches details sequentially in groups of 50, and rejects missing, duplicate, or unexpected detail identity. API and Worker runtimes remain intentionally unchanged until Stage 14C.4B.2A.2; temporary duplicate source logic is controlled, with only the API client active.

## Stage 14C.4B.2A.2a.1 order-client contract parity

Before API cutover, the active API client contract was inventoried. All direct call sites are the API client’s focused contract tests; its public methods are `listOrders`, `listAllInWindow`, and `getOrderDetails`.

| Active API method | Shared-core equivalent | Status |
| --- | --- | --- |
| `listOrders` | `ShopeeOrderClientCore.listOrders` | API CUTOVER COMPLETE: exactly one provider request, opaque cursor input/output, page metadata, 15-day and page-size validation. |
| `listAllInWindow` | `ShopeeOrderClientCore.listAllInWindow` | API CUTOVER COMPLETE: reuses the single-page primitive and rejects missing/repeated continuation cursors. |
| `getOrderDetails` | `ShopeeOrderClientCore.getOrderDetails` | API CUTOVER COMPLETE: sequential max-50 batching, provider response ordering, duplicate rejection, and explicit `missingOrderSns`. |

`collectOrderSns` remains the stricter collection helper for future adapter orchestration: it splits longer history ranges, follows pages, validates canonical non-empty `order_sn`, and deduplicates exact identifiers. `getCompleteOrderDetails` remains the strict helper for future adapters that require no partial result or unrelated identity.

## Stage 14C.4B.2A.2a.2 API order-client cutover

The API `ShopeeOrderClient` is now a thin Nest facade over `ShopeeOrderClientCore`. An API trusted-access adapter delegates only to the existing `ShopeeTokenService`/shared credential lifecycle, while the API transport adapter delegates only to the existing signed `ShopeeHttpClient`. The facade retains the three API contracts (`listOrders`, `listAllInWindow`, and `getOrderDetails`) and maps safe domain errors to Nest errors. It has no list pagination, window, batching, cursor, or provider-request orchestration. Worker OrderClient wiring, a Shopee adapter, normalization, and production registry registration remain deferred.

## Stage 14C.4B.2A.2b Worker order-client wiring

Worker now has a lazy `createWorkerShopeeOrderClient` factory. It wires the same `ShopeeOrderClientCore` to a Worker access-credential provider backed by `ShopeeCredentialLifecycle` and a Worker transport backed by the existing signed `ShopeeHttpClient`. It imports neither API source nor uses API HTTP. Focused synthetic parity tests cover page metadata and opaque cursors, pagination/window collection, sequential detail batching and response identity, plus provider auth/transient classification. Generic `marketplace-sync` remains credential-free, and no Shopee adapter, normalizer, registry entry, order request, or persistence path is active yet.

## Stage 14C.4B.2A.3a Shopee normalizer

`ShopeeNormalizer` is a pure server-only function/service over the existing generic `NormalizedMarketplaceOrder` contract. It maps `order_sn` exactly and without transformation to both `marketplaceOrderId` and provider-specific `rawOrderCode`; its platform literal is `SHOPEE`. It preserves non-empty raw provider status, provider `create_time`/`update_time` as JSON-safe ISO timestamps, direct currency, and the supported generic item fields. Provider totals, COD, payment/shipping values, masked buyer/recipient values, and seller message remain direct metadata values; no value is inferred, unmasked, reconstructed, or financially calculated.

Missing optional source fields remain absent, while missing/blank order identity, invalid update timestamp, invalid item quantity, and non-finite item price fail safely with non-retryable, PII-safe normalization errors. Empty item lists are accepted because the existing generic contract marks items optional. The normalizer neither mutates input nor stores raw provider data; the future adapter will separately preserve raw detail in `rawData`. ShopeeAdapter orchestration remains deferred to Stage 14C.4B.2A.3b.

## Stage 14C.4B.2A.3b.1 MarketplaceAdapter V2

The provider-neutral adapter contract now supplies sync type, requested window, and opaque committed checkpoint to one provider-owned sync operation. Provider adapters will own their list/detail pagination and return coherent raw/normalized source envelopes plus only a candidate checkpoint. Generic Worker code remains responsible for persistence, stale-update policy, Batch bridging, and committing the candidate checkpoint after all work succeeds. `rawData` and `normalizedData` are persisted separately. ShopeeAdapter remains deferred and is not registered.

## Stage 14C.4B.2A.3b.1A Shopee checkpoint semantics

Shopee durable checkpoint V1 is server-only, versioned opaque JSON: `{ "v": 1, "updatedThrough": <unix-seconds> }`. Generic queue/Worker code stores and passes this value without parsing it. A pagination `next_cursor`, request ID, credential, or provider secret is never a durable checkpoint.

An INITIAL run must provide its explicit requested window and uses `create_time`; its successful candidate checkpoint is `updatedThrough = windowEnd`. An INCREMENTAL run requires a V1 checkpoint, uses `update_time`, and receives one deterministic `windowEnd` persisted when the SyncRun is created. The Shopee resolver computes `timeFrom = updatedThrough - overlap` and `timeTo = persisted windowEnd`; the successful candidate remains `updatedThrough = windowEnd`, including an empty run. Therefore retries of the same SyncRun use the same provider upper bound.

`SHOPEE_INCREMENTAL_OVERLAP_SECONDS` is an Ecomkit reliability policy, not a Shopee platform requirement. It defaults to 300 seconds and accepts only integer values from 0 through 3600. The overlap safely replays boundary updates; generic source uniqueness and provider-update stale protection retain idempotency. ShopeeAdapter remains deferred.

## Stage 14C.4B.2A.3b.2 offline ShopeeAdapter

The Worker now contains an offline, unregistered `ShopeeAdapter` implementation of MarketplaceAdapter V2. It validates SHOPEE context, delegates INITIAL `create_time` and INCREMENTAL `update_time` bounds to the V1 checkpoint/window resolver, delegates all window splitting, pagination, exact `order_sn` deduplication, and detail batching to `ShopeeOrderClientCore`, and delegates field mapping to `ShopeeNormalizer`.

Each coherent result preserves the exact provider detail as JSON-safe `rawData`, uses the normalizer result as `normalizedData`, maps exact `order_sn` to both marketplace identity and raw order code, and returns the resolver's window-end candidate checkpoint. Missing, duplicate, unexpected, or malformed detail data fails the whole operation without a partial result. The adapter has no Prisma or API dependency, never handles credentials directly, does not commit checkpoints, and is not registered in the production marketplace-sync registry. Production registration and persistence validation remain Stage 14C.4B.2B.

## Stage 14C.4B.2B.1 production registry activation

The production Worker `MarketplaceAdapterRegistry` now registers `Platform.SHOPEE` through a lazy, cached factory that constructs the existing Worker OrderClient, `ShopeeNormalizer`, checkpoint resolver, and `ShopeeAdapter` stack. Registry initialization and adapter resolution perform no provider request, token refresh, or eager Shopee app-config validation, so the generic Worker starts without real Shopee credentials. Missing app configuration is classified as a bounded non-retryable error only when an actual provider transport operation is attempted.

The mock adapter remains an explicit test substitution through `MARKETPLACE_ENABLE_MOCK_ADAPTER=true`; unsupported platforms still fail deterministically. Queue payloads remain `{ connectionId, syncRunId }`, and the generic Worker still owns persistence, stale-update policy, Batch bridging, and checkpoint commit without handling provider credentials. This stage activates resolution only: a successful registered synthetic end-to-end Shopee sync remains deferred to Stage 14C.4B.2B.2, and no real provider traffic or credentials are used.
