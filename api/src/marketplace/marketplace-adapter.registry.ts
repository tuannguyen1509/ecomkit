import { Injectable } from "@nestjs/common";
import { Platform } from "@ecomkit/database";
import type { MarketplaceAdapter } from "./marketplace-adapter.js";

export class MarketplaceAdapterRegistryError extends Error {
  constructor(public readonly code: "MARKETPLACE_ADAPTER_NOT_REGISTERED" | "MARKETPLACE_ADAPTER_ALREADY_REGISTERED") {
    super(code);
    this.name = "MarketplaceAdapterRegistryError";
  }
}

@Injectable()
export class MarketplaceAdapterRegistry {
  private readonly adapters = new Map<Platform, MarketplaceAdapter>();

  register(adapter: MarketplaceAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new MarketplaceAdapterRegistryError("MARKETPLACE_ADAPTER_ALREADY_REGISTERED");
    }
    this.adapters.set(adapter.platform, adapter);
  }

  resolve(platform: Platform): MarketplaceAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new MarketplaceAdapterRegistryError("MARKETPLACE_ADAPTER_NOT_REGISTERED");
    }
    return adapter;
  }
}
