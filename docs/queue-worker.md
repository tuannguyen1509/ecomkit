# Queue / Worker

Stage 11 uses BullMQ 5.70.0 and the queue `batch-processing`. Jobs contain only `{ batchId }`; no raw files, customer data, credentials, or storage paths are stored in Redis. The deterministic job ID is `batch-<batchId>`; colon characters are not used.

`POST /api/batches/:batchId/process` returns `202` after enqueueing a Batch. A deterministic job ID (`batch-<batchId>`) prevents duplicate work. `GET /api/batches/:batchId/processing-status` returns Batch status and queue state/progress. Redis enqueue failures return the structured `QUEUE_UNAVAILABLE` response and do not move a Batch to processing.

The worker runs with concurrency `1` and calls the existing API parser and matching service endpoints in order: Excel, PDFs, then matching. This internal-Docker-network MVP adapter avoids duplicating business logic; it uses `DATABASE_URL` and `API_INTERNAL_URL`. Requests use the configurable `INTERNAL_API_TIMEOUT_MS` (default 30000); timeout and non-2xx responses fail the job and use the configured retry policy. It records ProcessingLog events, uses two attempts with exponential backoff (1000ms), retains 100 completed and 500 failed jobs, and closes its queue and Prisma client on shutdown. Completed Batches are not silently reprocessed. Deterministic business/data failures use `UnrecoverableError` and consume one attempt; parser idempotency prevents duplicate Orders and ProcessingErrors. A BullMQ `failedReason` from an earlier retry is historical only: the status API returns `lastError: null` once the final job state is completed.

## Authentication integration

The Worker requires `WORKER_INTERNAL_API_KEY` at startup and sends it only in `X-Ecomkit-Worker-Key` through its shared internal API helper. The API accepts that header only for its explicitly internal Excel, PDF, and matching routes. The key is never included in queue data, ProcessingLog, or browser requests; jobs still contain only `{ batchId }`. API and Worker must receive the same non-secret-managed deployment value. The Worker key is not an ADMIN credential and cannot call `/process` or browse history, results, errors, or exports.

The authenticated Docker queue flow is intentionally unchanged: a human session can enqueue a batch, while the Worker uses only its internal header for the three processing stages. The browser session and Worker key are never placed in the BullMQ payload.

Stage 13A classifies deterministic parser/business failures as non-retryable BullMQ errors. They fail after one attempt; timeout, network, and 5xx/internal API failures retain the existing two-attempt retry policy.
# Marketplace sync queue (Stage 14B.3)

The Worker container hosts two independent BullMQ Workers: existing `batch-processing` and `marketplace-sync`. Marketplace job data is limited to `connectionId` and `syncRunId`; it must never contain credentials, encrypted envelopes, provider payloads, buyer data, or browser sessions. The generic marketplace queue uses two retry attempts with exponential backoff. It serializes active syncs per connection through both the API transaction guard and a Redis ownership lock, while allowing different shops to run concurrently.

The production Worker registry now lazily registers `Platform.SHOPEE` with the provider-specific `ShopeeAdapter`. Registry initialization and resolution do not read Shopee app credentials, refresh tokens, or call the provider; provider configuration remains required only when an actual Shopee operation reaches the signed HTTP transport. `MARKETPLACE_ENABLE_MOCK_ADAPTER=true` explicitly substitutes the test-only mock for marketplace-sync regression runs. The generic queue payload and Worker remain credential-free.

Marketplace enqueue uses the same bounded operation timeout as the existing batch queue (`QUEUE_OPERATION_TIMEOUT_MS`, default 5000ms). If Redis is unavailable, the request transitions its newly-created SyncRun to `ERROR`, records one `MARKETPLACE_QUEUE_UNAVAILABLE` error, and creates neither a Batch nor source orders. After Redis recovers, a new run can be requested normally.
