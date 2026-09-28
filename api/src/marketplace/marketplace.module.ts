import { Module } from "@nestjs/common";
import { MarketplaceAdapterRegistry } from "./marketplace-adapter.registry.js";
import { MarketplaceConnectionService } from "./marketplace-connection.service.js";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { MarketplaceSyncQueueService } from "./marketplace-sync-queue.service.js";
import { ShopeeOAuthController } from "./shopee-oauth.controller.js";
import { ShopeeOAuthService } from "./shopee-oauth.service.js";
import { ShopeeOAuthStateStore } from "./shopee-oauth-state.store.js";

@Module({
  controllers: [ShopeeOAuthController],
  providers: [MarketplaceCredentialService, MarketplaceAdapterRegistry, MarketplaceConnectionService, MarketplaceSyncQueueService, ShopeeOAuthStateStore, ShopeeOAuthService],
  exports: [MarketplaceCredentialService, MarketplaceAdapterRegistry, MarketplaceConnectionService, MarketplaceSyncQueueService]
})
export class MarketplaceModule {}
