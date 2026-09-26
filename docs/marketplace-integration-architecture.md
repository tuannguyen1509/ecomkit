# Unified marketplace integration architecture (Stage 14A.1)

## Context

Ecomkit currently processes Excel and PDF inputs through parsing, matching, results, errors, history, and export. Marketplace APIs are an additional ingestion source; they do not replace the Excel/PDF workflow. Excel and PDF remain supported for manual operation, troubleshooting, fallback, and reconciliation.

Stage 6B Golden validation remains pending because an approved production Excel reference has not been supplied. This document is an architecture decision only. It adds no provider connection, credential handling, schema, migration, runtime behavior, or UI.

## One Marketplace System

Ecomkit will have one Marketplace system, with `Platform` as its discriminator. The existing shared platform vocabulary is reused conceptually: `SHOPEE`, `LAZADA`, `TIKTOK`, and `UNKNOWN`.

```text
Ecomkit
  └─ Marketplace Module
       ├─ ShopeeAdapter
       ├─ LazadaAdapter
       └─ TikTokShopAdapter
              ↓
       Normalized Marketplace Order
              ↓
       Existing Ecomkit reconciliation core
```

It must not become three independently designed “Shopee”, “Lazada”, and “TikTok” systems. Connection lifecycle, sync audit, normalized data, queue concepts, errors, permissions, history, result, and export are shared. Vendor-specific protocol behavior stays inside an adapter.

## Goals and non-goals

Goals are multi-shop-ready provider integration, source-preserving normalization, reuse of the current reconciliation core, and auditable syncs. The canonical matching key remains **`Mã đơn sàn`**.

Non-goals for this stage are real API access, OAuth, credentials, token persistence, provider SDKs, UI, Google Sheets, schema changes, and a generic framework disconnected from a real provider.

Marketplace order identity maps as follows:

```text
NormalizedMarketplaceOrder.marketplaceOrderId
  → Order.rawOrderCode / “Mã đơn sàn”
```

No customer-name, phone, address, product, amount, fuzzy, or heuristic matching is permitted.

## Proposed Marketplace Module

The future `MarketplaceModule` has the following responsibilities.

| Component | Owns | Must not own |
| --- | --- | --- |
| `MarketplaceConnectionService` | Connection lifecycle and validation orchestration | Provider request signing or generic Order matching |
| `MarketplaceAdapter` | Provider boundary contract | Ecomkit persistence policy or UI |
| `MarketplaceAdapterRegistry` | Selects one adapter by `Platform` | Provider-specific `if/else` flows in core services |
| `MarketplaceSyncService` | Starts, coordinates, and audits a sync | Provider protocol details |
| `MarketplaceNormalizer` | Converts provider DTOs into normalized source-faithful values | Guessed/enriched values |
| `MarketplaceErrorMapper` | Maps safe provider errors into actionable Ecomkit errors | Raw credential/error-payload exposure |
| `MarketplaceSyncQueue` | Future asynchronous sync-job dispatch | The existing Batch-processing queue’s business logic |

The initial adapter contract is intentionally Ecomkit-oriented, not a claim that every provider operates identically:

```text
getAuthorizationUrl()
exchangeAuthorizationCode()
refreshAccessToken()
validateConnection()
listOrders()
getOrderDetail()
```

Adapters may implement these differently or report an unsupported operation where a provider requires another flow. Adapter implementations own API versioning, endpoint URLs, signatures, OAuth/token semantics, pagination, request/response formats, and provider status/error codes.

## Multi-shop connection model

The future conceptual `MarketplaceConnection` represents one external shop, not one platform. Its durable identity is:

```text
platform + externalShopId
```

The future database uniqueness constraint should therefore be `(platform, externalShopId)`, never `platform UNIQUE`. Candidate non-secret fields are `id`, `platform`, `externalShopId`, `shopName`, `status`, `lastSuccessfulSyncAt`, `lastAttemptedSyncAt`, `createdAt`, `updatedAt`, and `createdByUserId`.

A small lifecycle is sufficient initially: `PENDING_AUTH`, `ACTIVE`, `REAUTH_REQUIRED`, `DISABLED`, and `ERROR`. Credential/token architecture is defined below; provider-specific facts remain open until official documentation is verified.

## Normalized marketplace source model

The future `NormalizedMarketplaceOrder` is an in-memory/source contract, not a new Prisma model in this stage. Candidate values are:

```text
platform
connectionId
externalShopId
marketplaceOrderId
rawProviderStatus
createdAt
updatedAt
currency
items[]
rawSourceReference
```

`NormalizedMarketplaceOrderItem` may contain `externalItemId`, `sellerSku`, `platformSku`, `productName`, `variationName`, `quantity`, and `unitPrice`. Values are populated only when supplied by the provider. Missing source values remain `NULL`; adapters must not infer SKUs, product mappings, prices, or financial values.

Future marketplace provenance should extend, not replace, existing `Order.sourceRefs`. A conceptual source reference contains `sourceType: MARKETPLACE_API`, `platform`, `connectionId`, `externalShopId`, `externalOrderId`, and `syncRunId`. Existing Excel/PDF file-row-page provenance remains intact.

## Batch versus MarketplaceSyncRun

Three options were assessed:

| Option | Assessment |
| --- | --- |
| A. API sync always creates a `Batch` | Reuses downstream UI, but incorrectly treats a remote sync as uploaded files and makes retry/audit semantics ambiguous. |
| B. Separate `MarketplaceSyncRun` only | Correct sync semantics, but would require duplicating result/error/history integration. |
| C. Hybrid | A `MarketplaceSyncRun` is the audit and operational unit; a core `Batch` is created or linked only when normalized data enters the existing reconciliation pipeline. |

**Recommendation: Option C (hybrid).** A sync run records provider/connection/window/attempt/lifecycle information. A linked Batch keeps existing processing logs, errors, orders, results, history, and export coherent. This minimizes disturbance to Stage 0–13 while preserving correct remote-sync auditability and future scalability. Stage 14A.2 will decide exact relations, retention, idempotency, and whether a sync can create more than one Batch.

## Existing core impact

The existing core remains the reconciliation authority:

- `Batch`: retained; later becomes the downstream reconciliation container linked from a sync run when appropriate.
- `UploadedFile`: retained unchanged for Excel/PDF. Marketplace API data must not masquerade as an uploaded file.
- `Order` and `OrderItem`: reused after normalized source data reaches the core; existing `Platform`, `rawOrderCode`, `normalizedOrderCode`, NULL rules, and matching invariants remain authoritative.
- `ProcessingLog` and `ProcessingError`: retained. Future sync errors must follow existing safe, actionable error principles rather than create a parallel error UX.
- `sourceRefs`: extended conceptually for API provenance while preserving file provenance.
- Result, Error, History, and Export: reused. There is no separate marketplace result/export system.

## Permissions and integration boundaries

Ecomkit retains only `ADMIN` and `USER`; no marketplace-specific Ecomkit roles are needed. ADMIN should create, authorize, disable, and view connection configuration. USER must never view or manage provider credentials. A later product decision may permit USER-initiated manual sync for an already active connection; the default recommendation is ADMIN-only until the operational/audit model is implemented.

Google Sheets is downstream of the normalized Ecomkit domain and integration layer:

```text
Marketplace / Excel / PDF → Normalized Ecomkit domain → Result / Integration layer → Google Sheets
```

An adapter must never write directly to Google Sheets.

## Implementation strategy and roadmap

Recommend a **minimum common foundation with a mock adapter**, followed by the first real provider vertical slice once official documentation, developer approval, and development authorization are available. This prevents premature provider assumptions while still validating the generic contracts before production connectivity.

Shopee is the architectural first-provider recommendation because it is the intended sequence and has one current shop. Actual implementation must be chosen only after developer/API approval is available; if another provider is approved first, it may be the first vertical slice without changing this unified architecture.

Recommended sequence:

```text
14A.1 Unified Marketplace Core Architecture
14A.2 Data Model + Sync Architecture
14A.3 OAuth + Security + Queue + Error Architecture
14A.4 Integration Boundaries + Roadmap Closure

14B Marketplace Core Foundation + mock adapter
14C Shopee
14D Lazada
14E TikTok Shop
14F Marketplace Operations UI / Auto-Sync
15 Google Sheets Automation
```

## Data model proposal (Stage 14A.2)

The future source layer needs three core models. They are design proposals only; no Prisma schema or migration is created in this stage.

```text
User
  └── MarketplaceConnection
           ├── MarketplaceSyncRun ── 0..1 → Batch
           └── MarketplaceExternalOrder
                    └── source provenance → Order
```

### MarketplaceConnection — required

`MarketplaceConnection` represents one provider shop. It has many sync runs and many source orders, but should not directly own Batches or Master Orders; those links belong to a particular sync run or provenance record. Essential non-secret fields are `id`, `platform`, `externalShopId`, `shopName`, `status`, `lastSuccessfulSyncAt`, `lastAttemptedSyncAt`, `createdByUserId`, `createdAt`, and `updatedAt`.

`@@unique([platform, externalShopId])` is the authoritative multi-shop identity. A status index is useful for active-connection operations. Connections are soft-disabled, not hard-deleted, so audit history remains valid. Credential fields remain implementation work for Stage 14B.

### MarketplaceSyncRun — required

`MarketplaceSyncRun` is one logical remote synchronization and belongs to one connection. It has a nullable, unique `batchId`: a run has zero or one downstream Batch, and a Batch belongs to at most one marketplace sync run. This prevents a Batch from mixing multiple provider connections while retaining the current Batch model for reconciliation.

Recommended fields and their meaning:

| Field | Meaning |
| --- | --- |
| `connectionId` | Shop being synchronized. |
| `batchId` | Linked reconciliation Batch, created only after complete fetch/normalization succeeds. |
| `syncType` | Semantic data scope: `INITIAL` or `INCREMENTAL`. |
| `triggerType` | Operational initiator: `MANUAL`, `SCHEDULED`, or `SYSTEM`; kept separate from sync scope. |
| `status` | `PENDING → QUEUED → PROCESSING → SUCCESS` or `ERROR`. No `PARTIAL_SUCCESS` in the MVP. |
| `startedAt`, `completedAt` | Operational audit timestamps. |
| `windowStart`, `windowEnd` | Requested/effective provider retrieval window when supported. |
| `startCursor`, `resultCursor` | Audit of input checkpoint and candidate output checkpoint. |
| `ordersFetched` | Provider records returned, including known records. |
| `ordersNormalized` | Returned records mapped to the normalized contract. |
| `ordersCreated` | Newly created source-order rows. |
| `ordersUpdated` | Existing source rows whose accepted state changed. |
| `warningCount`, `errorCount` | Safe operational totals. |
| `createdByUserId` | Existing User who requested a manual run; nullable for automation. |

`RETRY` should not be a sync type. A retry is another execution attempt of the same logical `MarketplaceSyncRun`, retaining its audit identity and counters. Concrete queue attempt/backoff values remain implementation work for Stage 14B after provider documentation is verified.

Useful future indexes are `(connectionId, startedAt)`, `(connectionId, status)`, `status`, and unique `batchId` where non-null.

### MarketplaceExternalOrder — required

`MarketplaceExternalOrder` is required as the durable API source layer. Existing `Order` is a reconciliation/Master Order, while an API order needs provider identity, current source state, update detection, replay safety, and a raw/normalized snapshot without coupling all provider state to the Master Order.

Essential future fields are `id`, `connectionId`, `marketplaceOrderId`, `rawProviderStatus`, `providerCreatedAt`, `providerUpdatedAt`, `normalizedData`, `rawData`, `lastSeenAt`, `createdAt`, and `updatedAt`. The authoritative idempotency rule is `@@unique([connectionId, marketplaceOrderId])`; a provider order identifier cannot safely be assumed globally unique across shops. Index `providerUpdatedAt` where supplied and retain a connection lookup index.

For the first MVP, retain the latest normalized JSON and a bounded/latest raw provider JSON snapshot on the source order, rather than a snapshot-table-per-response. This supports debugging and remapping while limiting model proliferation. Raw API data can include personal data, so it remains internal, is not broadly returned by Result/History APIs, and must have a future retention/cleanup policy. No retention duration is selected here.

## Normalized contract and order identity

The normalized in-memory contract is finalized conceptually as:

```text
NormalizedMarketplaceOrder {
  platform, connectionId, externalShopId, marketplaceOrderId,
  rawProviderStatus, providerCreatedAt, providerUpdatedAt,
  currency, items[], rawSourceReference
}

NormalizedMarketplaceOrderItem {
  externalItemId?, sellerSku?, platformSku?, productName?,
  variationName?, quantity?, unitPrice?
}
```

All item values are provider-dependent and nullable. Missing source data remains `NULL`; no financial, SKU, or product mapping is inferred.

`marketplaceOrderId` is preserved as the provider identifier and maps to `Order.rawOrderCode` / **`Mã đơn sàn`** when materialized into the existing core. It may be trimmed only if the provider contract permits it. It must not be case-folded, have internal spaces removed, or be reformatted without provider-specific proof that doing so is safe.

On a later sync, the same `(connectionId, marketplaceOrderId)` source order is updated in place, not inserted again. A provider update must not blindly overwrite Excel/PDF-derived fields on an existing Master Order. Stage 14B must apply provenance-aware field ownership and leave values unresolved/NULL where business source priority has not been approved.

Recommended marketplace provenance is minimal and source-specific:

```json
{
  "sourceType": "MARKETPLACE_API",
  "platform": "SHOPEE",
  "connectionId": "…",
  "externalShopId": "…",
  "marketplaceOrderId": "…",
  "sourceOrderId": "…",
  "syncRunId": "…"
}
```

It complements existing Excel/PDF row/page provenance and does not replace it.

## Sync lifecycle, checkpoint, and replay

### Initial and incremental sync

The first run uses `INITIAL`; its historical window is selected by an ADMIN/request and constrained by the approved provider's capabilities. No arbitrary historical duration is chosen now. Incremental runs use the last committed connection checkpoint plus a bounded, configurable provider-specific overlap window to safely refetch late updates.

Cursor/checkpoint state belongs in both places for different reasons:

- `MarketplaceSyncRun` stores the start cursor/checkpoint and candidate result cursor for audit.
- `MarketplaceConnection` stores only the last **successfully committed** checkpoint for the next incremental run.

The checkpoint commit rule is strict:

```text
read committed checkpoint
→ fetch / normalize / upsert source orders
→ complete the run and downstream Batch creation
→ mark SUCCESS
→ commit new connection checkpoint
```

On failure, the previous successful checkpoint remains authoritative. An overlap can intentionally refetch orders; source uniqueness absorbs it, so it creates no duplicate source records, Master Orders, or provenance references.

Provider updates are accepted only when safe relative to an authoritative `providerUpdatedAt` or provider version. An older response must not overwrite a newer source state. When no authoritative timestamp/version exists, the adapter must define a safe provider-specific rule rather than the core assuming one.

### Batch creation and failure boundary

One `MarketplaceSyncRun` creates zero or one Batch. It creates the Batch only after provider retrieval and normalization have completed coherently. A fetch, authorization, cursor, or pagination failure before that point leaves the run `ERROR` with no fake Batch and no fake UploadedFile.

For the MVP, a partial pagination failure is an `ERROR`, not `PARTIAL_SUCCESS`; the checkpoint is not advanced and no incomplete reconciliation Batch is created. Source rows already upserted during page fetch can remain safely, because retrying the same run upserts them by source uniqueness. This preserves auditability without silently presenting an incomplete reconciliation as successful.

## Concurrency, retries, and counts

The core invariant is one active sync per `MarketplaceConnection`; different connections may later run concurrently. The queue architecture below recommends the concrete job identity and per-connection lock; it must not impose a global marketplace lock.

Retries stay attached to one logical SyncRun. Replaying a run or overlap window is safe because source records are upserted deterministically and Batch creation happens only after a coherent successful retrieval. The run's counters mean:

- `ordersFetched`: provider records returned, including known records.
- `ordersNormalized`: returned records mapped to the normalized contract.
- `ordersCreated`: newly persisted source records.
- `ordersUpdated`: existing source records whose accepted state changed.

## History, Result, and errors

Marketplace Sync History is a future operational history separate from the current `/history`, which remains Batch/reconciliation history. A successful sync links to its Batch, Result, Error view, and Export; there is no separate marketplace Result system.

Pre-Batch failures cannot cleanly use the current `ProcessingError`, because that model requires a `batchId`. Stage 14B should add a minimal sync-scoped error representation (for example `MarketplaceSyncError` related to `MarketplaceSyncRun`) for connection/authentication/cursor/provider failures. Once a Batch exists, reconciliation errors continue to use existing `ProcessingError` and its actionability UI. This is a deliberate minimal schema concern, not an instruction to create a fake Batch solely to carry an API error.

Connection and run audit records should be retained; no cascade should casually erase SyncRun/source-order history when a connection is disabled. Source/raw-data retention and cleanup must become deployment/business policy in a later stage.

## Stage 14A.3 design record

The next sections record the security, queue, and error boundaries selected in Stage 14A.3. They are design decisions only; implementation remains in the later foundation stage.

## Credential and authorization architecture (Stage 14A.3)

### Separate application and shop credentials

Application credentials identify Ecomkit's provider application (for example an app/partner ID and app secret). They are provider-wide deployment secrets, not per-shop data. The secure MVP recommendation is environment or production-secret-manager configuration read only by the relevant provider adapter. They must not be persisted in ordinary connection rows unless a later provider/business requirement makes that unavoidable.

Shop authorization credentials belong to one `MarketplaceConnection`: external shop identity, encrypted access/refresh tokens where the provider uses them, expiry/authorization metadata, and granted scopes. They must not be combined with application credentials into one opaque field.

### Encrypted shop credential storage

Token material and authorization codes are never stored plaintext. The future `MarketplaceCredentialService` encrypts/decrypts connection token material using authenticated encryption, recommended as AES-256-GCM. It owns encryption, decryption, redaction, atomic refreshed-token replacement, and version-aware future rotation. It must not call provider business APIs, return plaintext tokens to Web clients, or log them.

Use a versioned serialized envelope in one encrypted credential field rather than scattered token columns:

```text
version + iv/nonce + ciphertext + authTag
```

The version supports future algorithm/key rotation without treating old ciphertext as a new token format. The future `MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY` comes only from an untracked local environment file or a production secret manager. It is never committed, baked into Docker images, exposed to Web, inserted into Redis, or logged. `.env.example` may later have a blank placeholder only.

### OAuth authorization and callback

The generic authorization flow is:

```text
ADMIN starts authorization
→ generate cryptographically random state
→ store short-lived pending authorization context
→ redirect to provider
→ provider callback
→ validate and consume state
→ exchange code
→ identify authorized shop
→ encrypt and persist credentials
→ validate required scope/connection
→ mark connection ACTIVE
```

Pending authorization context is best kept in Redis with a short TTL and atomic consume/delete behavior. It contains only safe identifiers needed to validate the callback: platform, initiating ADMIN/session binding where available, state digest or state value, intended return context, and expiry. Redis is already deployed and is suitable for short-lived single-use state; it does not replace durable connection audit data.

OAuth state is cryptographically random, single-use, short-lived, platform-bound, and bound to the initiating admin/session where practical. The callback must reject missing, expired, reused, or provider-mismatched state; require an authorization code; avoid logging full callback queries; and discard the authorization code immediately after exchange. A connection becomes ACTIVE only after exchange, shop identification, encrypted persistence, and required scope validation all succeed.

A production callback requires a stable HTTPS endpoint, conceptually `https://<production-domain>/api/marketplaces/<platform>/callback`. Exact path, local tunnel approach, and provider callback constraints remain provider research questions.

### Refresh and reauthorization

Provider requests load/decrypt credentials only in the smallest provider-call scope. The adapter determines whether refresh is required, calls refresh where supported, and atomically writes the complete replacement credential envelope plus expiry metadata before continuing. Access token, refresh token, and expiry must be updated together; a partial credential update is invalid.

One active sync per connection is the primary refresh-race control. Stage 14A.3 additionally recommends a short per-connection Redis refresh lock around refresh itself, because future connection validation/detail calls may exist outside the main sync path. The lock is scoped to one connection, never global. If refresh fails because authorization is invalid or non-refreshable, mark the connection `REAUTH_REQUIRED`, create an actionable sync error, and stop retrying provider calls until an ADMIN reconnects it. Token refresh alone never advances an order-sync checkpoint.

An ADMIN may set a connection `DISABLED`; disabled connections enqueue no new sync jobs or provider calls, retain encrypted credentials/history by default, and are not hard-deleted. Temporary network/rate-limit errors leave the connection ACTIVE. Authorization revocation or an irrecoverable refresh failure moves it to `REAUTH_REQUIRED`.

## Marketplace sync queue architecture

Marketplace retrieval uses a separate future BullMQ queue, conceptually `marketplace-sync`. It must not reuse `batch-processing`, because provider retrieval has distinct locking, quotas, error classes, and lifecycle semantics.

The payload contains identifiers only:

```json
{
  "connectionId": "...",
  "syncRunId": "..."
}
```

The deterministic safe job ID is `marketplace-sync-<syncRunId>`. One logical job exists per SyncRun; neither token, app secret, buyer data, raw order data, password, nor session cookie may enter Redis.

For MVP operational simplicity, use the existing Worker deployment with a separate BullMQ Worker instance for the marketplace queue. This keeps one container/service while isolating queue names, processors, concurrency, and observability. A dedicated Marketplace Worker container can be introduced later only if provider traffic, scaling, or isolation proves it necessary.

The invariant is enforced at three boundaries: a connection-level active-run guard in durable state, deterministic job identity for a run, and a per-connection distributed lock during processing. Frontend button state is never the authority. Different connections can later process in parallel; there is no global marketplace sync lock.

Completed and failed BullMQ job retention remains bounded operational metadata. `MarketplaceSyncRun` and sync errors in PostgreSQL are the durable audit record.

## Retry, provider quotas, and state safety

Adapters and a safe error mapper classify failures structurally, not by matching human messages.

| Class | Examples | Behavior |
| --- | --- | --- |
| Retryable | network failure, timeout, temporary provider 5xx, upstream outage, provider rate limit | bounded retry with configured exponential backoff; honor `Retry-After` when safely supplied |
| Non-retryable | disabled connection, authorization revoked, invalid app credential, missing permission, deterministic malformed provider response | terminal SyncRun error; no useless retry |

Backoff, attempt counts, timeout values, and provider concurrency are configuration-driven and must be selected after provider documentation is verified. Provider clients/adapters expose a normalized `RATE_LIMITED`, `retryable`, and optional `retryAfter` outcome; the core must not guess provider quotas. Per-connection request serialization/throttling is recommended to avoid detail-request bursts exhausting a shop's quota.

All provider HTTP calls require a bounded timeout. A rate-limit or retryable failure leaves the SyncRun non-successful and never advances the connection checkpoint. Already-upserted source rows remain replay-safe under the Stage 14A.2 uniqueness rule.

A terminal worker failure or crash recovery path must settle the SyncRun to `ERROR`, never leave it indefinitely PROCESSING, and never report false SUCCESS.

## MarketplaceSyncError and actionability

`MarketplaceSyncError` is required for pre-Batch provider/sync errors. It belongs to `MarketplaceSyncRun`; `connectionId` is derivable through that relationship and should not be duplicated unless a measured query requirement later justifies denormalization.

Minimal conceptual fields are:

```text
id, syncRunId, operation, internalCode, externalCode?, httpStatus?,
retryable, message, suggestedAction, safeContext?, createdAt
```

`operation` should be a bounded application enum or validated string vocabulary such as `AUTHORIZE`, `EXCHANGE_TOKEN`, `REFRESH_TOKEN`, `VALIDATE_CONNECTION`, `LIST_ORDERS`, `GET_ORDER_DETAIL`, `SYNC_ORDERS`, and `NORMALIZE_ORDER`. It must not contain provider secrets or raw request data.

Safe context may include platform, external shop ID, sync run ID, non-sensitive cursor/page/order identifiers, HTTP status, retry-after, and a validation field. It must exclude access/refresh tokens, app secrets, Authorization headers, signed URLs/queries, signatures, and unnecessary buyer address or phone data.

Actionability follows existing Ecomkit principles. An authorization failure tells an ADMIN to reconnect the shop; a missing permission identifies the required order-read capability; a rate limit says the system is retrying automatically. Retryable failures must not prematurely ask staff to manually correct data. Provider list-order/auth/cursor failures remain SyncRun errors; once a Batch exists, parser/matching/reconciliation errors remain existing `ProcessingError` records. The same failure must not be duplicated into both systems without a clear independent meaning.

## Permissions, worker security, and observability

No new Ecomkit roles are required. ADMIN may authorize/reconnect, disable, inspect sync errors/status, and trigger manual sync. USER may view non-sensitive connection/sync status, view resulting errors/results, and—recommended MVP policy—trigger a manual sync only for an ACTIVE connection. USER may never view credentials or modify authorization/connection configuration. Every manual sync request uses the existing authenticated ADMIN/USER model; no public provider-triggered sync endpoint exists. Scheduled/system runs use `triggerType = SCHEDULED` or `SYSTEM` and no fake user.

The worker receives only queue identifiers, loads the encrypted credential by connection ID, and decrypts it transiently in process memory for a provider call. Decrypted credentials are never persisted, logged, inserted into ProcessingLog, returned to a browser, or written to the queue.

Safe logs include platform, connection ID, external shop ID, sync run ID, operation, duration, and safe HTTP status. Logs must redact credentials, Authorization headers, signed requests/queries, signatures, full callback parameters, and unnecessary PII. The same redaction boundary applies to API errors and future provider HTTP client diagnostics.

## Provider implementation questions

Before any real provider vertical slice, verify from official provider documentation: exact authorization flow, refresh-token availability and lifetime, credential format, signing algorithm, required scopes, stable callback requirements, quotas/`Retry-After`, pagination/cursor semantics, and order update timestamps/versions. No provider-specific value is assumed by this architecture.

## Integration boundaries and roadmap closure (Stage 14A.4)

### Marketplace UI boundary

The future frontend is one Marketplace area, conceptually `/marketplaces`, with connection and sync-history views such as `/marketplaces/connections` and `/marketplaces/sync-history`. It groups shops by `Platform` rather than creating separate Shopee, Lazada, and TikTok applications.

Connection management is ADMIN-facing and displays only safe operational values: platform, shop name, external shop ID, connection status, last successful sync, last attempted sync, and actions such as Connect, Reconnect, Disable, Validate, and Sync now. It never displays access tokens, refresh tokens, app secrets, or the credential-encryption key.

USER may view safe connection status, sync history, and linked Batch/Result/Error data. The final MVP recommendation permits USER to request **Đồng bộ đơn hàng** only for an ACTIVE connection; ADMIN remains responsible for connect, reconnect, disable, and all credential configuration. `REAUTH_REQUIRED` shows “Cần quản trị viên kết nối lại tài khoản sàn.” A DISABLED connection cannot enqueue a sync. Existing backend authorization remains the authority; no new Ecomkit role is needed.

### History, Result, Error, and Export

Marketplace Sync History is separate from the existing `/history`, because a SyncRun contains remote API lifecycle details that do not belong in file/reconciliation Batch history. Its traversal is:

```text
Marketplace Sync History → SyncRun → linked Batch → existing Result / Error / Export
```

The existing Batch history remains unchanged. Marketplace integration does not create another Result, Error, or Export system. The canonical 24-column Master Output remains authoritative; API data only fills existing columns when a later approved mapping explicitly provides a source value. It neither changes output-column order nor invents financial values; NULL remains blank in export.

Existing `sourceRefs` may later expose a safe source label such as Marketplace API, platform, and shop name/ID. It must never expose credentials. Pre-Batch provider errors use `MarketplaceSyncError`; post-Batch normalization/materialization/reconciliation errors use existing `ProcessingError`, with consistent actionable language.

### Google Sheets and future integrations

Google Sheets remains downstream of reconciled Ecomkit data:

```text
Marketplace / Excel / PDF ingestion
→ Normalized / reconciled Ecomkit data
→ IntegrationOutputService
→ Google Sheets
```

No provider adapter may write directly to Sheets. A future `IntegrationOutputService` is a simple boundary, not an event-bus requirement. Future configuration may include spreadsheet ID/URL, monthly pattern such as `T{MM}`, fallback tab, audit-log tab, order-code column, and field-to-column mapping. Sheets idempotency must be based on configurable `Mã đơn sàn` identity and update/upsert behavior rather than blind append.

### Stage 14B minimum foundation

Stage 14B should implement the smallest generic foundation that validates the architecture without connecting a production marketplace:

| Scope | Decision |
| --- | --- |
| `MarketplaceConnection` | REQUIRED |
| `MarketplaceSyncRun` | REQUIRED |
| `MarketplaceExternalOrder` | REQUIRED |
| `MarketplaceSyncError` | REQUIRED |
| Prisma migration and relations | REQUIRED |
| Adapter interface and registry | REQUIRED |
| Credential-encryption service | REQUIRED |
| Connection/source-order repositories and SyncRun lifecycle | REQUIRED |
| `marketplace-sync` queue foundation | REQUIRED |
| Mock/fake adapter and focused tests | REQUIRED |
| Production provider API connection | NOT in the generic foundation |

The minimum relations are `User → MarketplaceConnection`, `MarketplaceConnection → MarketplaceSyncRun`, `MarketplaceConnection → MarketplaceExternalOrder`, `MarketplaceSyncRun → MarketplaceSyncError`, and `MarketplaceSyncRun → 0..1 Batch`. Required uniqueness remains `(platform, externalShopId)` for a connection, `(connectionId, marketplaceOrderId)` for a source order, and at most one SyncRun per linked Batch.

**Recommendation: Option A.** Stage 14B is generic foundation plus a mock adapter; Stage 14C is the Shopee vertical slice. This avoids building a production provider integration before developer approval, credentials, and official documentation are available, while still testing the real abstractions. It also keeps Stage 14B manageable and prevents premature vendor assumptions.

### Provider rollout and operational gates

Preferred rollout remains Shopee, then Lazada, then TikTok Shop. If Shopee developer approval is unavailable but Lazada or TikTok is approved first, the first adapter may change without redesigning the unified system.

Before writing any provider-specific adapter, verify current official provider documentation and development authorization for app registration, OAuth, signing, callback URLs, token/refresh behavior, scopes, order APIs/status fields, pagination, API versions, rate limits, and order-history limits. Do not rely on remembered or copied provider behavior.

Before production rollout require HTTPS, a stable public callback domain, provider-approved callback URLs, approved developer applications, strong secret management, credential-encryption key management, backup/restore validation, monitoring, credential-rotation procedure, migration/rollback procedure, and provider API smoke tests. Credential envelope versioning supports a future rotation process.

If a provider outage occurs, Ecomkit remains usable through Excel/PDF. The connection remains ACTIVE for transient failures, the SyncRun retries/fails safely, and no checkpoint advances. If credentials are corrupted or lost, mark the connection `REAUTH_REQUIRED`; an ADMIN reconnects it while historical SyncRuns, Orders, Results, and Errors remain preserved.

### Remaining provider-specific questions

The only open questions are external/provider facts: exact Shopee OAuth and signing requirements; Lazada token lifecycle; TikTok Shop scopes; each provider's approval policy, callback restrictions, rate limits, `Retry-After` behavior, API versions, pagination/cursor model, order-history window, and authoritative update timestamps. These must be answered from official current documentation before the corresponding vertical slice.

## Final roadmap

```text
14A Unified Marketplace Architecture
  14A.1 Core Architecture
  14A.2 Data + Sync Architecture
  14A.3 OAuth + Security + Queue + Errors
  14A.4 Integration Boundaries + Closure

14B Marketplace Core Foundation (generic models, queue, encryption, mock adapter)
14C Shopee integration
14D Lazada integration
14E TikTok Shop integration
14F Marketplace Operations UI / Auto-Sync
15  Google Sheets Automation
```

Marketplace API remains an optional ingestion source. It does not replace the Excel/PDF workflow and does not satisfy Stage 6B Golden validation. Stage 6B stays pending until an approved production Excel reference is available.

## Stage 14B.1 schema implementation record

Stage 14B.1 implements only the foundation data model: `MarketplaceConnection`, `MarketplaceSyncRun`, `MarketplaceExternalOrder`, and `MarketplaceSyncError`, with the status/type/trigger enums defined above. `MarketplaceConnection` stores an opaque nullable `syncCursor` as the committed checkpoint shape; individual runs retain nullable start/result cursors for audit. The one-to-zero-or-one SyncRun-to-Batch link is nullable and unique.

No credential envelope, access token, refresh token, app secret, provider service, adapter, queue processor, endpoint, or UI is introduced in this migration. Credential fields are deliberately deferred to Stage 14B.2 with the `MarketplaceCredentialService`. The active-run invariant is supported by SyncRun indexes but its transactional/queue locking enforcement is also deferred to the later service and queue foundation; no speculative PostgreSQL partial unique index is introduced.

Connection/source/run/error history uses restrictive or set-null foreign-key behavior rather than cascade deletion. Connections remain soft-disabled through their status. Existing Batch, Order, OrderItem, ProcessingError, authentication, and Excel/PDF behavior are unchanged.
