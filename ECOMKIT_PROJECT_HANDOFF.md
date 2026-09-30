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
- 14D.5A Normalizer policy/implementation: PASS (`feat: add Lazada order normalizer`, this checkpoint commit)
- Real Lazada traffic: NO
- Lazada Adapter/registry/persistence: NOT IMPLEMENTED
- Prisma schema/migration change: NO

Stage 14D.5A adds a pure Lazada normalizer over verified raw order/items. Exact order and item identities are preserved. One provider status maps directly; mixed statuses leave the normalized order status absent while preserving the full distinct set. Repeated purchased units remain separate with quantity one. Optional malformed money fails safely; unsupported canonical fields remain null. No checkpoint is implemented.

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

Next after Stage 14D.5A commit: Stage 14D.5B — Lazada Marketplace Adapter Initial-Sync Foundation. It must remain INITIAL-only; do not implement durable incremental checkpoint semantics.
