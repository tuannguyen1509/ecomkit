import { ShopeeAdapter } from "./shopee-marketplace.adapter.js";
import { createWorkerShopeeOrderClient } from "./shopee-order.worker.js";

/** Lazily constructs the production Shopee provider stack without performing provider I/O. */
export function createWorkerShopeeAdapter(): ShopeeAdapter {
  return new ShopeeAdapter(createWorkerShopeeOrderClient().client);
}
