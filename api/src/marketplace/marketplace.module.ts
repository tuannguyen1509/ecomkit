import { Module } from "@nestjs/common";
import { MarketplaceAdapterRegistry } from "./marketplace-adapter.registry.js";
import { MarketplaceConnectionService } from "./marketplace-connection.service.js";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { MarketplaceSyncQueueService } from "./marketplace-sync-queue.service.js";
import { ShopeeOAuthController } from "./shopee-oauth.controller.js";
import { ShopeeOAuthService } from "./shopee-oauth.service.js";
import { ShopeeOAuthStateStore } from "./shopee-oauth-state.store.js";
import { ShopeeTokenService } from "./shopee-token.service.js";
import { ShopeeOrderClient } from "./shopee-order.client.js";
import { MarketplaceProviderConfigController } from "./marketplace-provider-config.controller.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";

@Module({
  controllers: [ShopeeOAuthController, MarketplaceProviderConfigController],
  providers: [MarketplaceCredentialService, MarketplaceProviderConfigService, MarketplaceAdapterRegistry, MarketplaceConnectionService, MarketplaceSyncQueueService, ShopeeOAuthStateStore, ShopeeOAuthService, ShopeeTokenService, ShopeeOrderClient],
  exports: [MarketplaceCredentialService, MarketplaceProviderConfigService, MarketplaceAdapterRegistry, MarketplaceConnectionService, MarketplaceSyncQueueService]
})
export class MarketplaceModule {}
