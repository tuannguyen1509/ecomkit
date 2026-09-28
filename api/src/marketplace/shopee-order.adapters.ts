import {
  type ShopeeAccessCredentialProvider,
  ShopeeOrderClientError,
  type ShopeeOrderDetailOptions,
  type ShopeeOrderTransport,
} from "@ecomkit/marketplace-server";
import { loadShopeeRuntimeConfig, ShopeeHttpClient, ShopeeHttpError } from "@ecomkit/shared";
import type { ShopeeResponse } from "@ecomkit/shared";
import { ShopeeTokenService } from "./shopee-token.service.js";

type ShopeeOrderListResponse = { more?: boolean; next_cursor?: string; order_list?: Array<Record<string, unknown>> };
type ShopeeOrderDetailResponse = { order_list?: Array<Record<string, unknown>> };
export type ApiShopeeOrderShopClient = {
  requestShop<T>(input: { operation: string; apiPath: string; method: "GET"; accessToken: string; shopId: string; query: Record<string, string | number | boolean | undefined> }): Promise<ShopeeResponse<T>>;
};

export class ApiShopeeAccessCredentialProvider implements ShopeeAccessCredentialProvider {
  constructor(private readonly tokens: ShopeeTokenService) {}
  ensureValidAccessToken(connectionId: string) { return this.tokens.ensureValidAccessToken(connectionId); }
}

export class ApiShopeeOrderTransport implements ShopeeOrderTransport {
  constructor(private readonly clientFactory: () => ApiShopeeOrderShopClient = () => new ShopeeHttpClient(loadShopeeRuntimeConfig())) {}

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
    const retryable = result.error === "error_server" || result.error === "error_network";
    const code = result.error === "common.error_auth" ? "SHOPEE_ORDER_PROVIDER_AUTH" : retryable ? "SHOPEE_ORDER_PROVIDER_TRANSIENT" : "SHOPEE_ORDER_PROVIDER_INVALID_RESPONSE";
    throw new ShopeeOrderClientError(code, retryable, result.request_id);
  }

  private toDomainError(error: unknown): ShopeeOrderClientError {
    if (error instanceof ShopeeOrderClientError) return error;
    if (error instanceof ShopeeHttpError) return new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_TRANSIENT", error.safe.retryableHint, error.safe.requestId);
    return new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_TRANSIENT", true);
  }
}
