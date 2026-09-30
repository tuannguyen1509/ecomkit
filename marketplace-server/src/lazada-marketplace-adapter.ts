import type {
  MarketplaceAdapter,
  MarketplaceAdapterAuthorizationCodeInput,
  MarketplaceAdapterAuthorizationInput,
  MarketplaceAdapterAuthorizationResult,
  MarketplaceAdapterConnectionIdentity,
  MarketplaceAdapterContext,
  MarketplaceAdapterOrder,
  MarketplaceAdapterSyncInput,
  MarketplaceAdapterSyncResult,
} from "@ecomkit/shared";
import {
  LAZADA_MULTIPLE_ORDER_ITEMS_MAX,
  type LazadaMultipleOrderItemsGroup,
  type LazadaRawOrder,
} from "./lazada-order-contract.js";
import { LazadaOrderClientError, type LazadaOrderClient } from "./lazada-order-client.js";
import { LazadaNormalizer } from "./lazada-normalizer.js";

export type LazadaMarketplaceAdapterErrorCode =
  | "LAZADA_ADAPTER_PLATFORM_INVALID"
  | "LAZADA_ADAPTER_OPERATION_UNSUPPORTED"
  | "LAZADA_INCREMENTAL_NOT_READY"
  | "LAZADA_INITIAL_WINDOW_REQUIRED"
  | "LAZADA_INITIAL_WINDOW_INVALID"
  | "LAZADA_WINDOW_UNSPLITTABLE"
  | "LAZADA_DUPLICATE_ORDER_CONFLICT"
  | "LAZADA_ITEM_GROUP_MISSING"
  | "LAZADA_ITEM_GROUP_UNEXPECTED"
  | "LAZADA_ITEM_GROUP_DUPLICATE";

export class LazadaMarketplaceAdapterError extends Error {
  readonly retryable = false;
  constructor(public readonly code: LazadaMarketplaceAdapterErrorCode) {
    super(code);
    this.name = "LazadaMarketplaceAdapterError";
  }
  toJSON(): object { return { name: this.name, code: this.code, retryable: false }; }
}
export type LazadaInitialWindow = Readonly<{ start: Date; end: Date }>;
export type LazadaOrderOperations = Pick<LazadaOrderClient, "listAllOrdersInWindow" | "getMultipleOrderItems">;

const MAX_SPLIT_DEPTH = 32;

/** Splits at whole-second resolution. Inclusive children intentionally share the midpoint. */
export function splitLazadaInclusiveWindow(window: LazadaInitialWindow): readonly [LazadaInitialWindow, LazadaInitialWindow] | null {
  const startMs = window.start.getTime(), endMs = window.end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;
  const startSecond = Math.ceil(startMs / 1_000), endSecond = Math.floor(endMs / 1_000);
  if (endSecond - startSecond < 2) return null;
  const midpointMs = Math.floor((startSecond + endSecond) / 2) * 1_000;
  if (midpointMs <= startMs || midpointMs >= endMs) return null;
  const midpoint = new Date(midpointMs);
  return [{ start: new Date(startMs), end: midpoint }, { start: midpoint, end: new Date(endMs) }];
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function sameSnapshot(left: LazadaRawOrder, right: LazadaRawOrder): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export class LazadaMarketplaceAdapter implements MarketplaceAdapter {
  readonly platform = "LAZADA" as const;

  constructor(
    private readonly orders: LazadaOrderOperations,
    private readonly normalizer = new LazadaNormalizer(),
  ) {}

  async getAuthorizationUrl(_input: MarketplaceAdapterAuthorizationInput): Promise<MarketplaceAdapterAuthorizationResult> {
    throw new LazadaMarketplaceAdapterError("LAZADA_ADAPTER_OPERATION_UNSUPPORTED");
  }
  async exchangeAuthorizationCode(_input: MarketplaceAdapterAuthorizationCodeInput): Promise<{ connection: MarketplaceAdapterConnectionIdentity }> {
    throw new LazadaMarketplaceAdapterError("LAZADA_ADAPTER_OPERATION_UNSUPPORTED");
  }
  async refreshAccessToken(_context: MarketplaceAdapterContext): Promise<void> {
    throw new LazadaMarketplaceAdapterError("LAZADA_ADAPTER_OPERATION_UNSUPPORTED");
  }
  async validateConnection(context: MarketplaceAdapterContext): Promise<MarketplaceAdapterConnectionIdentity> {
    this.assertContext(context);
    return { externalShopId: context.externalShopId };
  }

  async syncOrders(context: MarketplaceAdapterContext, input: MarketplaceAdapterSyncInput): Promise<MarketplaceAdapterSyncResult> {
    this.assertContext(context);
    if (input.syncType === "INCREMENTAL") throw new LazadaMarketplaceAdapterError("LAZADA_INCREMENTAL_NOT_READY");
    const window = this.initialWindow(input);
    const rawOrders = await this.collectWindow(context.connectionId, window, 0);
    const uniqueOrders = this.deduplicateOrders(rawOrders);
    if (uniqueOrders.length === 0) return { orders: [] };

    const groups = await this.fetchCompleteItemGroups(context.connectionId, uniqueOrders.map((order) => order.order_id));
    const envelopes: MarketplaceAdapterOrder[] = uniqueOrders.map((order) => {
      const items = groups.get(order.order_id)!;
      const normalizedData = this.normalizer.normalize({ order, items });
      return {
        marketplaceOrderId: order.order_id,
        rawOrderCode: order.order_id,
        rawData: { order: clone(order), items: clone(items) },
        normalizedData,
        providerUpdatedAt: normalizedData.providerUpdatedAt!,
      };
    });
    return { orders: envelopes };
  }

  private assertContext(context: MarketplaceAdapterContext): void {
    if (context.platform !== "LAZADA") throw new LazadaMarketplaceAdapterError("LAZADA_ADAPTER_PLATFORM_INVALID");
  }

  private initialWindow(input: MarketplaceAdapterSyncInput): LazadaInitialWindow {
    if (!input.windowStart || !input.windowEnd) throw new LazadaMarketplaceAdapterError("LAZADA_INITIAL_WINDOW_REQUIRED");
    const start = new Date(input.windowStart), end = new Date(input.windowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
      throw new LazadaMarketplaceAdapterError("LAZADA_INITIAL_WINDOW_INVALID");
    }
    return { start, end };
  }

  private async collectWindow(connectionId: string, window: LazadaInitialWindow, depth: number): Promise<readonly LazadaRawOrder[]> {
    try {
      const result = await this.orders.listAllOrdersInWindow({
        connectionId,
        window: { mode: "CREATE_TIME", from: window.start.toISOString(), to: window.end.toISOString() },
        limit: 100,
        sortDirection: "ASC",
      });
      return result.orders;
    } catch (error) {
      if (!(error instanceof LazadaOrderClientError) || error.code !== "LAZADA_WINDOW_TOO_LARGE") throw error;
      if (depth >= MAX_SPLIT_DEPTH) throw new LazadaMarketplaceAdapterError("LAZADA_WINDOW_UNSPLITTABLE");
      const children = splitLazadaInclusiveWindow(window);
      if (!children) throw new LazadaMarketplaceAdapterError("LAZADA_WINDOW_UNSPLITTABLE");
      const earlier = await this.collectWindow(connectionId, children[0], depth + 1);
      const later = await this.collectWindow(connectionId, children[1], depth + 1);
      return [...earlier, ...later];
    }
  }

  private deduplicateOrders(orders: readonly LazadaRawOrder[]): readonly LazadaRawOrder[] {
    const unique = new Map<string, LazadaRawOrder>();
    for (const order of orders) {
      const existing = unique.get(order.order_id);
      if (!existing) { unique.set(order.order_id, order); continue; }
      if (sameSnapshot(existing, order)) continue;
      const existingUpdated = Date.parse(existing.updated_at), incomingUpdated = Date.parse(order.updated_at);
      if (!Number.isFinite(existingUpdated) || !Number.isFinite(incomingUpdated) || existingUpdated === incomingUpdated) {
        throw new LazadaMarketplaceAdapterError("LAZADA_DUPLICATE_ORDER_CONFLICT");
      }
      if (incomingUpdated > existingUpdated) unique.set(order.order_id, order);
    }
    return [...unique.values()];
  }

  private async fetchCompleteItemGroups(connectionId: string, orderIds: readonly string[]): Promise<Map<string, LazadaMultipleOrderItemsGroup["order_items"]>> {
    const all = new Map<string, LazadaMultipleOrderItemsGroup["order_items"]>();
    for (let index = 0; index < orderIds.length; index += LAZADA_MULTIPLE_ORDER_ITEMS_MAX) {
      const requested = orderIds.slice(index, index + LAZADA_MULTIPLE_ORDER_ITEMS_MAX);
      const requestedSet = new Set(requested);
      const response = await this.orders.getMultipleOrderItems(connectionId, requested);
      for (const group of response.groups) {
        if (!requestedSet.has(group.order_id)) throw new LazadaMarketplaceAdapterError("LAZADA_ITEM_GROUP_UNEXPECTED");
        if (all.has(group.order_id)) throw new LazadaMarketplaceAdapterError("LAZADA_ITEM_GROUP_DUPLICATE");
        all.set(group.order_id, group.order_items);
      }
      for (const orderId of requested) if (!all.has(orderId)) throw new LazadaMarketplaceAdapterError("LAZADA_ITEM_GROUP_MISSING");
    }
    return all;
  }
}
