import { Module } from "@nestjs/common";
import { MarketplaceAdapterRegistry } from "./marketplace-adapter.registry.js";
import { MarketplaceConnectionService } from "./marketplace-connection.service.js";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";

@Module({
  providers: [MarketplaceCredentialService, MarketplaceAdapterRegistry, MarketplaceConnectionService],
  exports: [MarketplaceCredentialService, MarketplaceAdapterRegistry, MarketplaceConnectionService]
})
export class MarketplaceModule {}
