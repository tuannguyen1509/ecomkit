import { Module } from "@nestjs/common";
import { MarketplaceAdapterRegistry } from "./marketplace-adapter.registry.js";
import { MarketplaceConnectionService } from "./marketplace-connection.service.js";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { MarketplaceSyncQueueService } from "./marketplace-sync-queue.service.js";

@Module({
  providers: [MarketplaceCredentialService, MarketplaceAdapterRegistry, MarketplaceConnectionService, MarketplaceSyncQueueService],
  exports: [MarketplaceCredentialService, MarketplaceAdapterRegistry, MarketplaceConnectionService, MarketplaceSyncQueueService]
})
export class MarketplaceModule {}
