# Shopee live read-only / legacy comparison

Status: **VALIDATION_PENDING**

This document intentionally contains no credentials, customer PII, request signatures, or credential envelopes.

## Safety mode

- Credential source: `EXTERNAL_IMPORT`
- Refresh ownership: `EXTERNAL`
- Ecomkit OAuth/refresh/revoke: forbidden
- Allowed provider operations: read-only Order List and Order Detail
- Legacy system writes: forbidden

## Exact comparison record

Complete this table only after an ADMIN imports a current access token locally and supplies a legacy `order_sn` export for the identical filter.

| Field | Value |
| --- | --- |
| Comparison date | PENDING |
| Safe/masked shop identity | PENDING |
| `time_range_field` | PENDING |
| `time_from` (Unix seconds) | PENDING |
| `time_to` (Unix seconds) | PENDING |
| Timezone interpretation | PENDING |
| Order status filter | PENDING |
| Legacy unique `order_sn` | PENDING |
| Shopee raw unique `order_sn` | PENDING |
| Details | PENDING |
| Normalized | PENDING |
| ExternalOrder | PENDING |
| Canonical Order | PENDING |
| Result | PENDING |
| Missing in Ecomkit | PENDING |
| Extra in Ecomkit | PENDING |
| Exact-set result | PENDING |

Exact comparison is case-sensitive set equality by `order_sn`. Fuzzy matching by customer, phone, address, item, or SKU is prohibited. Any mismatch must be classified from evidence as `WINDOW_MISMATCH`, `TIMEZONE_MISMATCH`, `STATUS_FILTER_MISMATCH`, `PAGINATION_MISS`, `DETAIL_MISS`, `NORMALIZATION_DROP`, `STALE_POLICY_EFFECT`, `LEGACY_FILTER_DIFFERENCE`, or `UNKNOWN`.

## Current external blockers

- No imported external access token is stored in the local runtime.
- Server encryption key is not configured in the canonical runtime.
- Partner ID/Partner Key are not present in the canonical runtime environment.
- No exact-window legacy `order_sn` artifact has been provided.

Therefore `SHOPEE_LEGACY_DATA_MATCH` remains **PENDING** and Lazada/TikTok work must not start.
