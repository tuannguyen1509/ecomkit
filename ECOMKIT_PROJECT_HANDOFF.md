# Ecomkit — Vui Khỏe project handoff

Updated: 2026-09-30

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
- 14D.5B MarketplaceAdapter INITIAL-sync foundation: PASS (`feat: add Lazada initial sync adapter`, this checkpoint commit)
- Real Lazada traffic: NO
- Lazada Adapter: INITIAL-only foundation implemented; not production-registered
- Lazada registry/persistence: NOT IMPLEMENTED
- Prisma schema/migration change: NO

Stage 14D.5B adds a server-only Lazada MarketplaceAdapter over the existing OrderClient and Normalizer. It requires a bounded INITIAL create-time window, splits only windows that exceed Lazada's offset ceiling, deduplicates inclusive boundaries by exact order ID, batches item groups up to 50, and rejects missing/extra/duplicate groups. Raw and normalized envelopes remain separate. INCREMENTAL is rejected before provider/lifecycle access and no candidate checkpoint is returned.

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

Next: Stage 14D.5C — Lazada Registered Synthetic Initial-Sync E2E. Wire the adapter into the production registry/factory carefully while keeping INCREMENTAL rejected and all provider traffic synthetic. Prove ExternalOrder through Batch, canonical Order, Result/Error, and Export without real Lazada calls.
