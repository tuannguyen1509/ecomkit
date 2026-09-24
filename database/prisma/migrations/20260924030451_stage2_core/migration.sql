-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('EXCEL', 'PDF');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('SHOPEE', 'LAZADA', 'TIKTOK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "MatchingStatus" AS ENUM ('MATCHED', 'PDF_NOT_FOUND', 'EXCEL_NOT_FOUND', 'DUPLICATE', 'PARSE_ERROR');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ProcessingLogLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "excel_file_count" INTEGER NOT NULL DEFAULT 0,
    "pdf_file_count" INTEGER NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_files" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "sanitized_filename" TEXT NOT NULL,
    "file_type" "FileType" NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'UNKNOWN',
    "mime_type" TEXT,
    "size_bytes" BIGINT,
    "storage_path" TEXT,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "raw_text" TEXT,
    "raw_structure" JSONB,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "raw_order_code" TEXT,
    "normalized_order_code" TEXT,
    "platform" "Platform" NOT NULL DEFAULT 'UNKNOWN',
    "matching_status" "MatchingStatus" NOT NULL DEFAULT 'PARSE_ERROR',
    "order_date" TIMESTAMP(3),
    "eshop_order_code" TEXT,
    "sales_channel" TEXT,
    "order_status" TEXT,
    "customer_name" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "province_city" TEXT,
    "vat_issued_date" TIMESTAMP(3),
    "note" TEXT,
    "amount_collected" DECIMAL(20,4),
    "receivable_status" TEXT,
    "difference_amount" DECIMAL(20,4),
    "product_price_vat_8" DECIMAL(20,4),
    "total_cost_percent" DECIMAL(9,4),
    "total_amount_to_collect" DECIMAL(20,4),
    "affiliate_fee_vuikhoe" DECIMAL(20,4),
    "discount_vuikhoe" DECIMAL(20,4),
    "discount_percent_vuikhoe" DECIMAL(9,4),
    "fixed_platform_fee" DECIMAL(20,4),
    "service_platform_fee" DECIMAL(20,4),
    "transaction_platform_fee" DECIMAL(20,4),
    "platform_cost_percent" DECIMAL(9,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_name" TEXT,
    "sku" TEXT,
    "quantity" INTEGER,
    "price" DECIMAL(20,4),
    "variant" TEXT,
    "weight" DECIMAL(20,4),
    "raw_product_text" TEXT,
    "source_platform" "Platform" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_errors" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "uploaded_file_id" TEXT,
    "order_id" TEXT,
    "error_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sheet_name" TEXT,
    "page_number" INTEGER,
    "row_number" INTEGER,
    "column_name" TEXT,
    "field_name" TEXT,
    "raw_value" TEXT,
    "severity" "Severity" NOT NULL,
    "cause" TEXT,
    "impact" TEXT,
    "suggested_action" TEXT,
    "raw_context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_logs" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "uploaded_file_id" TEXT,
    "order_id" TEXT,
    "level" "ProcessingLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batches_created_at_idx" ON "batches"("created_at");

-- CreateIndex
CREATE INDEX "batches_processing_status_idx" ON "batches"("processing_status");

-- CreateIndex
CREATE INDEX "uploaded_files_batch_id_idx" ON "uploaded_files"("batch_id");

-- CreateIndex
CREATE INDEX "uploaded_files_platform_idx" ON "uploaded_files"("platform");

-- CreateIndex
CREATE INDEX "uploaded_files_processing_status_idx" ON "uploaded_files"("processing_status");

-- CreateIndex
CREATE INDEX "uploaded_files_created_at_idx" ON "uploaded_files"("created_at");

-- CreateIndex
CREATE INDEX "orders_batch_id_idx" ON "orders"("batch_id");

-- CreateIndex
CREATE INDEX "orders_normalized_order_code_idx" ON "orders"("normalized_order_code");

-- CreateIndex
CREATE INDEX "orders_matching_status_idx" ON "orders"("matching_status");

-- CreateIndex
CREATE INDEX "orders_platform_idx" ON "orders"("platform");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_batch_id_normalized_order_code_idx" ON "orders"("batch_id", "normalized_order_code");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "processing_errors_batch_id_idx" ON "processing_errors"("batch_id");

-- CreateIndex
CREATE INDEX "processing_errors_uploaded_file_id_idx" ON "processing_errors"("uploaded_file_id");

-- CreateIndex
CREATE INDEX "processing_errors_order_id_idx" ON "processing_errors"("order_id");

-- CreateIndex
CREATE INDEX "processing_errors_error_code_idx" ON "processing_errors"("error_code");

-- CreateIndex
CREATE INDEX "processing_errors_severity_idx" ON "processing_errors"("severity");

-- CreateIndex
CREATE INDEX "processing_errors_created_at_idx" ON "processing_errors"("created_at");

-- CreateIndex
CREATE INDEX "processing_logs_batch_id_idx" ON "processing_logs"("batch_id");

-- CreateIndex
CREATE INDEX "processing_logs_created_at_idx" ON "processing_logs"("created_at");

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_errors" ADD CONSTRAINT "processing_errors_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_errors" ADD CONSTRAINT "processing_errors_uploaded_file_id_fkey" FOREIGN KEY ("uploaded_file_id") REFERENCES "uploaded_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_errors" ADD CONSTRAINT "processing_errors_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_uploaded_file_id_fkey" FOREIGN KEY ("uploaded_file_id") REFERENCES "uploaded_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
