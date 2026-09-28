import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ShopeeOrderClientCore, ShopeeOrderClientError, type ShopeeOrderDetailOptions, type ShopeeOrderListInput } from "@ecomkit/marketplace-server";
import { ShopeeTokenService } from "./shopee-token.service.js";
import { ApiShopeeAccessCredentialProvider, ApiShopeeOrderTransport, type ApiShopeeOrderShopClient } from "./shopee-order.adapters.js";

export type ShopeeTimeRangeField = "create_time" | "update_time";
export type ShopeeOrderStatus = "UNPAID" | "READY_TO_SHIP" | "PROCESSED" | "SHIPPED" | "COMPLETED" | "IN_CANCEL" | "CANCELLED" | "INVOICE_PENDING";
export type ShopeeOrderListItem = { order_sn: string; order_status?: ShopeeOrderStatus; booking_sn?: string };
export type ShopeeOrderItem = { item_id?: number; item_name?: string; item_sku?: string; model_id?: number; model_name?: string; model_sku?: string; model_quantity_purchased?: number; model_original_price?: number; model_discounted_price?: number; order_item_id?: number; line_item_id?: number };
export type ShopeeOrderDetail = { order_sn: string; region?: string; currency?: string; cod?: number; total_amount?: number; order_status?: string; create_time?: number; update_time?: number; message_to_seller?: string; payment_method?: string; shipping_carrier?: string; recipient_address?: Record<string, unknown>; item_list?: ShopeeOrderItem[]; package_list?: Record<string, unknown>[] };
export type ShopeeOrderProtocolError = ShopeeOrderClientError;
export { batchShopeeOrderSns as batchShopeeOrderSn, splitShopeeOrderWindows as splitShopeeWindows } from "@ecomkit/marketplace-server";

@Injectable()
export class ShopeeOrderClient {
  private readonly core: ShopeeOrderClientCore;
  constructor(tokens: ShopeeTokenService, clientFactory?: () => ApiShopeeOrderShopClient) { this.core = new ShopeeOrderClientCore(new ApiShopeeAccessCredentialProvider(tokens), new ApiShopeeOrderTransport(clientFactory)); }
  async listOrders(connectionId: string, input: { timeRangeField: ShopeeTimeRangeField; timeFrom: number; timeTo: number; pageSize?: number; cursor?: string; orderStatus?: ShopeeOrderStatus; responseOptionalFields?: string; requestOrderStatusPending?: boolean }): Promise<{ orders: ShopeeOrderListItem[]; more: boolean; nextCursor?: string; requestId?: string }> {
    try { return await this.core.listOrders(connectionId, input as ShopeeOrderListInput) as { orders: ShopeeOrderListItem[]; more: boolean; nextCursor?: string; requestId?: string }; } catch (error) { throw this.toNestError(error); }
  }
  async listAllInWindow(connectionId: string, input: Omit<Parameters<ShopeeOrderClient["listOrders"]>[1], "cursor">): Promise<ShopeeOrderListItem[]> { try { return await this.core.listAllInWindow(connectionId, input as Omit<ShopeeOrderListInput, "cursor">) as ShopeeOrderListItem[]; } catch (error) { throw this.toNestError(error); } }
  async getOrderDetails(connectionId: string, orderSns: readonly string[], optional: { responseOptionalFields?: string; requestOrderStatusPending?: boolean } = {}): Promise<{ orders: ShopeeOrderDetail[]; missingOrderSns: string[] }> { try { return await this.core.getOrderDetails(connectionId, orderSns, optional as ShopeeOrderDetailOptions) as { orders: ShopeeOrderDetail[]; missingOrderSns: string[] }; } catch (error) { throw this.toNestError(error); } }
  private toNestError(error: unknown): Error { if (!(error instanceof ShopeeOrderClientError)) return new ServiceUnavailableException({ errorCode: "SHOPEE_ORDER_PROVIDER_TRANSIENT", message: "Shopee order request failed temporarily." }); if (error.retryable) return new ServiceUnavailableException({ errorCode: error.code, message: "Shopee order request failed temporarily.", ...(error.requestId ? { requestId: error.requestId } : {}) }); return new BadRequestException({ errorCode: error.code, message: "Shopee order request is invalid.", ...(error.requestId ? { requestId: error.requestId } : {}) }); }
}
