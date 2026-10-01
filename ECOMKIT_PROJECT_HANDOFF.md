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
