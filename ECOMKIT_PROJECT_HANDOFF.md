# Ecomkit — Vui Khỏe project handoff

Updated: 2026-10-01

Repository: `C:\Users\nkluck\ecomkit`
Branch: `vuikhoe`

## Canonical project state

This repository copy was restored from the existing Downloads handoff during Stage 14D.5A and is canonical going forward. The Downloads copy is preserved and was not deleted or blindly overwritten.

Lazada:

- 14D.1 requirements/architecture: PASS
- 14D.2 signer + HTTP client: PASS
- 14D.3A OAuth/token acquisition: PASS
- 14D.3B refresh lifecycle/cross-runtime safety: PASS (`8db5e4f`)
- 14D.4A Order API contracts/fixtures: PASS (`4de5e2f`)
- 14D.4B OrderClient foundation: PASS (`8239a3d`)
- 14D.5A Normalizer policy/implementation: PASS (`b5515eb`)
- 14D.5B MarketplaceAdapter INITIAL-sync foundation: PASS (`10e2197`)
- 14D.5C registered synthetic INITIAL pipeline: PASS (`feat: register Lazada initial sync pipeline`, this checkpoint commit)
- Real Lazada traffic: NO
- Lazada Adapter: INITIAL-only and production-registered
- Lazada synthetic runtime/persistence: PASS; live provider validation not performed
- Prisma schema/migration change: NO

Stage 14D.5C registers Lazada lazily in the production Worker registry and proves the complete generic INITIAL pipeline with synthetic config and fake transport: lifecycle, OrderClient, adapter, ExternalOrder, Batch, canonical Order/OrderItem, Result, History, XLSX, and CSV. Missing configuration fails safely, repeated units remain separate, no fake UploadedFile is created, and idempotency/provider isolation remain connection-scoped. INCREMENTAL is rejected before provider calls and no checkpoint is committed. No real Lazada traffic or credentials were used.

Unresolved Lazada facts remain:

- whether every relevant item-status transition advances order-level `updated_at`
- complete current status enumeration
- app-specific QPS/rate limits

Durable incremental checkpoint semantics remain deferred.

Shopee remains unchanged:

- Stage 14C.6B: `VALIDATION_PENDING`
- `SHOPEE_LEGACY_DATA_MATCH`: `PENDING`
- Stage 14C.7B manual visual acceptance: PENDING
- Stage 6B Golden: PENDING

Git safety: do not reset, clean, force push, or push automatically.

Next: Stage 14D.6A — Lazada Admin Configuration + External Read-Only Validation Foundation. Keep external validation refresh-owned by the source system, import no refresh token, and permit only one narrow read-only test. Durable incremental sync remains deferred.

## Stage 14D.6A update (2026-10-01)

Automated foundation: PASS. Manual UI/live validation: PENDING. ADMIN can save Lazada Vietnam App Key/App Secret using the generic provider config, import externally managed Seller ID/Access Token/expiry without a refresh token, run a no-network structural check, and explicitly run one narrow read-only GetOrders test. Secrets are encrypted and absent from safe GET responses. Automated validation used fake transport only; no real Lazada traffic occurred and no Prisma migration was added.

Shopee remains `VALIDATION_PENDING`; `SHOPEE_LEGACY_DATA_MATCH` and Stage 14C.7B manual visual acceptance remain PENDING. Lazada incremental checkpoint remains deferred.

Next after manual acceptance: Stage 14D.6B — Lazada live read-only validation and legacy data comparison. Never import or refresh the legacy refresh token.

## Documentation checkpoint and priority decision (2026-10-01)

- Root `README.md` was refreshed from the current repository, Compose, workspace scripts, environment template, security documentation, routes, and canonical handoff.
- Lazada is paused at Stage 14D.6A `AUTOMATED PASS / MANUAL_REQUIRED`; no Lazada code was removed or rolled back, and `LAZADA_LEGACY_DATA_MATCH` remains `PENDING`.
- Project priority has returned to Shopee Stage 14C.6B. Its status remains `VALIDATION_PENDING`, and `SHOPEE_LEGACY_DATA_MATCH` remains `PENDING` until an exact live `order_sn` set comparison passes.
- TikTok Shop remains not started. Stage 6B Golden and Stage 14C.7B manual visual acceptance remain pending.

Next: resume Stage 14C.6B — Shopee Live Read-Only Validation + Legacy Data Match. If Shopee Developer approval or valid external prerequisites are unavailable, preserve `VALIDATION_PENDING`; do not fabricate live acceptance.

## Stage 14C.6C update (2026-10-01)

- Shopee OAuth connection activation: automated implementation and synthetic validation complete; manual provider authorization remains required and approval/Redirect URI dependent.
- ADMIN OAuth start now resolves the existing encrypted `MarketplaceProviderConfig`, creates one-time Redis state, and returns the officially signed `/api/v2/shop/auth_partner` URL without making a provider call.
- The public callback atomically consumes state, validates `code` and `shop_id`, reuses the existing token client/signer, stores Access/Refresh Token in the versioned encrypted credential envelope, captures Shop ID automatically, and redirects safely to `/marketplaces` without secrets.
- Reauthorization updates the same `(platform, externalShopId)` connection. External-owned credentials remain unchanged when OAuth acquisition fails and transition to OAuth/ECOMKIT ownership only after successful acquisition.
- Marketplace UI displays safe Shop ID/token-presence/expiry metadata and keeps external read-only mode separate. No provider revoke, escrow, sync enqueue, Batch, ExternalOrder, Prisma change, or real automated Shopee traffic was added.
- Stage 14C.6B remains `VALIDATION_PENDING`; `SHOPEE_LEGACY_DATA_MATCH` remains `PENDING`. Lazada remains paused at Stage 14D.6A `MANUAL_REQUIRED`, with `LAZADA_LEGACY_DATA_MATCH = PENDING`.

Next: perform the manual Shopee OAuth authorization when Developer Console approval and the configured callback permit it, then resume Stage 14C.6B live read-only validation and exact legacy `order_sn` comparison. Do not mark live validation complete from synthetic OAuth tests.
