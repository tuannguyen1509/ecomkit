import { Platform } from "@ecomkit/database";
import type { MarketplaceAdapter } from "@ecomkit/shared";
import { MarketplaceMockAdapter } from "./marketplace-mock.adapter.js";
import { createWorkerShopeeAdapter } from "./shopee-marketplace.worker.js";
import { createWorkerLazadaAdapter } from "./lazada-marketplace.worker.js";

export type MarketplaceAdapterFactory = () => MarketplaceAdapter;

export class WorkerMarketplaceAdapterRegistryError extends Error {
  constructor(public readonly code: "MARKETPLACE_ADAPTER_ALREADY_REGISTERED" | "MARKETPLACE_ADAPTER_NOT_REGISTERED") {
    super(code);
    this.name = "WorkerMarketplaceAdapterRegistryError";
  }
}

/** Provider-neutral, lazy registry for Worker marketplace adapters. */
export class WorkerMarketplaceAdapterRegistry {
  private readonly factories = new Map<Platform, MarketplaceAdapterFactory>();
  private readonly instances = new Map<Platform, MarketplaceAdapter>();

  registerFactory(platform: Platform, factory: MarketplaceAdapterFactory): void {
    if (this.factories.has(platform)) throw new WorkerMarketplaceAdapterRegistryError("MARKETPLACE_ADAPTER_ALREADY_REGISTERED");
    this.factories.set(platform, factory);
  }

  resolve(platform: Platform): MarketplaceAdapter {
    const existing = this.instances.get(platform);
    if (existing) return existing;
    const factory = this.factories.get(platform);
    if (!factory) throw new WorkerMarketplaceAdapterRegistryError("MARKETPLACE_ADAPTER_NOT_REGISTERED");
    const adapter = factory();
    this.instances.set(platform, adapter);
    return adapter;
  }

  get(platform: Platform): MarketplaceAdapter | undefined {
    if (!this.factories.has(platform)) return undefined;
    return this.resolve(platform);
  }
}

export function createWorkerMarketplaceAdapterRegistry(input: Readonly<{
  enableMockAdapter?: boolean;
  shopeeFactory?: MarketplaceAdapterFactory;
  lazadaFactory?: MarketplaceAdapterFactory;
  mockFactory?: MarketplaceAdapterFactory;
}> = {}): WorkerMarketplaceAdapterRegistry {
  const registry = new WorkerMarketplaceAdapterRegistry();
  const useMock = input.enableMockAdapter ?? process.env.MARKETPLACE_ENABLE_MOCK_ADAPTER === "true";
  registry.registerFactory(Platform.SHOPEE, useMock
    ? input.mockFactory ?? (() => new MarketplaceMockAdapter())
    : input.shopeeFactory ?? createWorkerShopeeAdapter);
  registry.registerFactory(Platform.LAZADA, input.lazadaFactory ?? createWorkerLazadaAdapter);
  return registry;
}
