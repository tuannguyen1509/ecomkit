-- CreateEnum
CREATE TYPE "MarketplaceConnectionStatus" AS ENUM ('PENDING_AUTH', 'ACTIVE', 'REAUTH_REQUIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MarketplaceSyncStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "MarketplaceSyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MarketplaceSyncType" AS ENUM ('INITIAL', 'INCREMENTAL');

-- CreateTable
CREATE TABLE "marketplace_connections" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "external_shop_id" TEXT NOT NULL,
    "shop_name" TEXT,
    "status" "MarketplaceConnectionStatus" NOT NULL DEFAULT 'PENDING_AUTH',
    "last_successful_sync_at" TIMESTAMP(3),
    "last_attempted_sync_at" TIMESTAMP(3),
    "sync_cursor" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_sync_runs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "sync_type" "MarketplaceSyncType" NOT NULL,
    "trigger_type" "MarketplaceSyncTrigger" NOT NULL,
    "status" "MarketplaceSyncStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "start_cursor" TEXT,
    "result_cursor" TEXT,
    "orders_fetched" INTEGER NOT NULL DEFAULT 0,
    "orders_normalized" INTEGER NOT NULL DEFAULT 0,
    "orders_created" INTEGER NOT NULL DEFAULT 0,
    "orders_updated" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "triggered_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_external_orders" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "marketplace_order_id" TEXT NOT NULL,
    "raw_provider_status" TEXT,
    "provider_created_at" TIMESTAMP(3),
    "provider_updated_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_data" JSONB,
    "normalized_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_external_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_sync_errors" (
    "id" TEXT NOT NULL,
    "sync_run_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "internal_code" TEXT NOT NULL,
    "external_code" TEXT,
    "http_status" INTEGER,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "suggested_action" TEXT,
    "safe_context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_sync_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_connections_status_idx" ON "marketplace_connections"("status");

-- CreateIndex
CREATE INDEX "marketplace_connections_created_by_user_id_idx" ON "marketplace_connections"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_connections_platform_external_shop_id_key" ON "marketplace_connections"("platform", "external_shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_sync_runs_batch_id_key" ON "marketplace_sync_runs"("batch_id");

-- CreateIndex
CREATE INDEX "marketplace_sync_runs_connection_id_status_idx" ON "marketplace_sync_runs"("connection_id", "status");

-- CreateIndex
CREATE INDEX "marketplace_sync_runs_connection_id_created_at_idx" ON "marketplace_sync_runs"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_sync_runs_status_idx" ON "marketplace_sync_runs"("status");

-- CreateIndex
CREATE INDEX "marketplace_external_orders_connection_id_provider_updated_at_idx" ON "marketplace_external_orders"("connection_id", "provider_updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_external_orders_connection_id_marketplace_order_id_key" ON "marketplace_external_orders"("connection_id", "marketplace_order_id");

-- CreateIndex
CREATE INDEX "marketplace_sync_errors_sync_run_id_created_at_idx" ON "marketplace_sync_errors"("sync_run_id", "created_at");

-- CreateIndex
CREATE INDEX "marketplace_sync_errors_internal_code_idx" ON "marketplace_sync_errors"("internal_code");

-- AddForeignKey
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sync_runs" ADD CONSTRAINT "marketplace_sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "marketplace_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sync_runs" ADD CONSTRAINT "marketplace_sync_runs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sync_runs" ADD CONSTRAINT "marketplace_sync_runs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_external_orders" ADD CONSTRAINT "marketplace_external_orders_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "marketplace_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sync_errors" ADD CONSTRAINT "marketplace_sync_errors_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "marketplace_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
