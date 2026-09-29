import {
  classifyShopeeOrderProviderError,
  type ShopeeAccessCredentialProvider,
  ShopeeCredentialLifecycle,
  ShopeeOrderClientCore,
  ShopeeOrderClientError,
  type ShopeeOrderDetailOptions,
  type ShopeeOrderTransport,
} from "@ecomkit/marketplace-server";
import { loadShopeeRuntimeConfig, ShopeeConfigError, ShopeeHttpClient, ShopeeHttpError } from "@ecomkit/shared";
import type { ShopeeResponse } from "@ecomkit/shared";
import { createWorkerShopeeCredentialLifecycle, type WorkerRedisDistributedLockProvider } from "./shopee-lifecycle.worker.js";

type ShopeeOrderListResponse = { more?: boolean; next_cursor?: string; order_list?: Array<Record<string, unknown>> };
type ShopeeOrderDetailResponse = { order_list?: Array<Record<string, unknown>> };
export type WorkerShopeeOrderShopClient = {
  requestShop<T>(input: { operation: string; apiPath: string; method: "GET"; accessToken: string; shopId: string; query: Record<string, string | number | boolean | undefined> }): Promise<ShopeeResponse<T>>;
};

export class WorkerShopeeAccessCredentialProvider implements ShopeeAccessCredentialProvider {
  constructor(private readonly lifecycle: ShopeeCredentialLifecycle) {}
  ensureValidAccessToken(connectionId: string) { return this.lifecycle.ensureValidAccessToken(connectionId); }
}

export class WorkerShopeeOrderTransport implements ShopeeOrderTransport {
  constructor(private readonly clientFactory: () => WorkerShopeeOrderShopClient = () => new ShopeeHttpClient(loadShopeeRuntimeConfig())) {}

  async list(credential: Awaited<ReturnType<ShopeeAccessCredentialProvider["ensureValidAccessToken"]>>, input: Parameters<ShopeeOrderTransport["list"]>[1]) {
    try {
      const result = await this.clientFactory().requestShop<ShopeeOrderListResponse>({
        operation: "SHOPEE_ORDER_LIST", apiPath: "/api/v2/order/get_order_list", method: "GET", accessToken: credential.accessToken, shopId: credential.shopId,
        query: { time_range_field: input.timeRangeField, time_from: input.timeFrom, time_to: input.timeTo, page_size: input.pageSize, cursor: input.cursor, order_status: input.orderStatus, response_optional_fields: input.responseOptionalFields, request_order_status_pending: input.requestOrderStatusPending },
      });
      this.assertSuccess(result);
      return { orders: result.response?.order_list, more: result.response?.more, nextCursor: result.response?.next_cursor, requestId: result.request_id };
    } catch (error) { throw this.toDomainError(error); }
  }

  async details(credential: Awaited<ReturnType<ShopeeAccessCredentialProvider["ensureValidAccessToken"]>>, orderSns: readonly string[], options: ShopeeOrderDetailOptions = {}) {
    try {
      const result = await this.clientFactory().requestShop<ShopeeOrderDetailResponse>({
        operation: "SHOPEE_ORDER_DETAIL", apiPath: "/api/v2/order/get_order_detail", method: "GET", accessToken: credential.accessToken, shopId: credential.shopId,
        query: { order_sn_list: orderSns.join(","), response_optional_fields: options.responseOptionalFields, request_order_status_pending: options.requestOrderStatusPending },
      });
      this.assertSuccess(result);
      return { orders: result.response?.order_list, requestId: result.request_id };
    } catch (error) { throw this.toDomainError(error); }
  }

  private assertSuccess(result: ShopeeResponse<unknown>): void {
    if (!result.error) return;
    const classification = classifyShopeeOrderProviderError(result.error);
    throw new ShopeeOrderClientError(classification.code, classification.retryable, result.request_id);
  }
  private toDomainError(error: unknown): ShopeeOrderClientError {
    if (error instanceof ShopeeOrderClientError) return error;
    if (error instanceof ShopeeConfigError) return new ShopeeOrderClientError(error.code, false);
    if (error instanceof ShopeeHttpError) return new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_TRANSIENT", error.safe.retryableHint, error.safe.requestId);
    return new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_TRANSIENT", true);
  }
}

export function createWorkerShopeeOrderClient(input: Readonly<{ lifecycle?: ShopeeCredentialLifecycle; clientFactory?: () => WorkerShopeeOrderShopClient }> = {}): { client: ShopeeOrderClientCore; lifecycle: ShopeeCredentialLifecycle; locks?: WorkerRedisDistributedLockProvider } {
  const owned = input.lifecycle ? undefined : createWorkerShopeeCredentialLifecycle();
  const lifecycle = input.lifecycle ?? owned!.lifecycle;
  return { client: new ShopeeOrderClientCore(new WorkerShopeeAccessCredentialProvider(lifecycle), new WorkerShopeeOrderTransport(input.clientFactory)), lifecycle, ...(owned ? { locks: owned.locks } : {}) };
}
