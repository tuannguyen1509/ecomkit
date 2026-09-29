CREATE TABLE "marketplace_provider_configs" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "environment" TEXT NOT NULL,
  "partner_id" TEXT NOT NULL,
  "partner_secret_envelope" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "last_tested_at" TIMESTAMP(3),
  "last_test_status" TEXT,
  "last_test_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketplace_provider_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketplace_provider_configs_platform_key" ON "marketplace_provider_configs"("platform");
CREATE INDEX "marketplace_provider_configs_is_enabled_idx" ON "marketplace_provider_configs"("is_enabled");
ALTER TABLE "marketplace_provider_configs" ADD CONSTRAINT "marketplace_provider_configs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketplace_provider_configs" ADD CONSTRAINT "marketplace_provider_configs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
