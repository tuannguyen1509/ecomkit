import { ShopeeAdapter } from "./shopee-marketplace.adapter.js";
import { createWorkerShopeeOrderClient } from "./shopee-order.worker.js";

/** Production-capable construction only; registration into marketplace-sync remains deferred. */
export function createWorkerShopeeAdapter(): ShopeeAdapter {
  return new ShopeeAdapter(createWorkerShopeeOrderClient().client);
}
