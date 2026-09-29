import { ShopeeAdapter } from "./shopee-marketplace.adapter.js";
import { createWorkerShopeeOrderClient } from "./shopee-order.worker.js";
import type { ShopeeOrderClientCore } from "@ecomkit/marketplace-server";

/** Lazily constructs the production Shopee provider stack without performing provider I/O. */
export function createWorkerShopeeAdapter(input: Readonly<{ orderClient?: ShopeeOrderClientCore }> = {}): ShopeeAdapter {
  return new ShopeeAdapter(input.orderClient ?? createWorkerShopeeOrderClient().client);
}
