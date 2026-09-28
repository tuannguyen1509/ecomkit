import type { NormalizedMarketplaceOrder, NormalizedMarketplaceOrderItem } from "@ecomkit/shared";

/** Provider-detail normalization is intentionally pure; persistence and raw snapshots belong to the adapter stage. */
export type ShopeeOrderItemForNormalization = Readonly<{ order_item_id?: number | string | null; line_item_id?: number | string | null; item_id?: number | string | null; item_name?: string | null; item_sku?: string | null; model_id?: number | string | null; model_name?: string | null; model_sku?: string | null; model_quantity_purchased?: number | null; model_original_price?: number | string | null; model_discounted_price?: number | string | null }>;
export type ShopeeOrderDetailForNormalization = Readonly<{ order_sn?: string | null; order_status?: string | null; create_time?: number | null; update_time?: number | null; currency?: string | null; total_amount?: number | string | null; cod?: number | string | null; payment_method?: string | null; shipping_carrier?: string | null; message_to_seller?: string | null; recipient_address?: Record<string, unknown> | null; buyer_username?: string | null; item_list?: readonly ShopeeOrderItemForNormalization[] | null }>;
export type ShopeeNormalizedMarketplaceOrder = NormalizedMarketplaceOrder & Readonly<{ platform: "SHOPEE"; rawOrderCode: string }>;

export class ShopeeNormalizationError extends Error {
  readonly retryable = false;
  constructor(public readonly code: "SHOPEE_NORMALIZATION_INVALID_ORDER_SN" | "SHOPEE_NORMALIZATION_INVALID_TIMESTAMP" | "SHOPEE_NORMALIZATION_INVALID_ITEM", public readonly field: string) {
    super(`Shopee normalization failed for ${field}.`);
    this.name = "ShopeeNormalizationError";
  }
  toJSON() { return { name: this.name, code: this.code, field: this.field, retryable: false }; }
}

function exactIdentifier(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const identifier = String(value);
  return identifier.length ? identifier : undefined;
}
function optionalText(value: string | null | undefined): string | undefined { return typeof value === "string" && value.length ? value : undefined; }
function optionalPrice(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) throw new ShopeeNormalizationError("SHOPEE_NORMALIZATION_INVALID_ITEM", "item_list.model_discounted_price");
  return String(value);
}
function timestamp(value: number | null | undefined, field: "create_time" | "update_time", required: boolean): string | undefined {
  if (value === null || value === undefined) {
    if (required) throw new ShopeeNormalizationError("SHOPEE_NORMALIZATION_INVALID_TIMESTAMP", field);
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) throw new ShopeeNormalizationError("SHOPEE_NORMALIZATION_INVALID_TIMESTAMP", field);
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) throw new ShopeeNormalizationError("SHOPEE_NORMALIZATION_INVALID_TIMESTAMP", field);
  return date.toISOString();
}
function jsonClone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class ShopeeNormalizer {
  normalize(order: ShopeeOrderDetailForNormalization): ShopeeNormalizedMarketplaceOrder {
    if (typeof order.order_sn !== "string" || !order.order_sn.trim()) throw new ShopeeNormalizationError("SHOPEE_NORMALIZATION_INVALID_ORDER_SN", "order_sn");
    const items = (order.item_list ?? []).map((item) => this.normalizeItem(item));
    const providerCreatedAt = timestamp(order.create_time, "create_time", false);
    const providerUpdatedAt = timestamp(order.update_time, "update_time", true);
    const rawProviderStatus = optionalText(order.order_status);
    const currency = optionalText(order.currency);
    const metadata: Record<string, unknown> = {};
    if (order.total_amount !== null && order.total_amount !== undefined) metadata.totalAmount = order.total_amount;
    if (order.cod !== null && order.cod !== undefined) metadata.cod = order.cod;
    if (optionalText(order.payment_method)) metadata.paymentMethod = order.payment_method;
    if (optionalText(order.shipping_carrier)) metadata.shippingCarrier = order.shipping_carrier;
    if (optionalText(order.message_to_seller)) metadata.messageToSeller = order.message_to_seller;
    if (optionalText(order.buyer_username)) metadata.buyerUsername = order.buyer_username;
    if (order.recipient_address) metadata.recipientAddress = jsonClone(order.recipient_address);
    return {
      platform: "SHOPEE",
      marketplaceOrderId: order.order_sn,
      rawOrderCode: order.order_sn,
      ...(rawProviderStatus ? { rawProviderStatus } : {}),
      ...(providerCreatedAt ? { providerCreatedAt } : {}),
      ...(providerUpdatedAt ? { providerUpdatedAt } : {}),
      ...(currency ? { currency } : {}),
      items,
      ...(Object.keys(metadata).length ? { providerMetadata: metadata } : {}),
    };
  }

  private normalizeItem(item: ShopeeOrderItemForNormalization): NormalizedMarketplaceOrderItem {
    if (item.model_quantity_purchased !== null && item.model_quantity_purchased !== undefined && (!Number.isInteger(item.model_quantity_purchased) || item.model_quantity_purchased < 0)) throw new ShopeeNormalizationError("SHOPEE_NORMALIZATION_INVALID_ITEM", "item_list.model_quantity_purchased");
    const externalItemId = exactIdentifier(item.order_item_id) ?? exactIdentifier(item.line_item_id) ?? exactIdentifier(item.item_id);
    const unitPrice = optionalPrice(item.model_discounted_price);
    const sellerSku = optionalText(item.model_sku);
    const platformSku = optionalText(item.item_sku);
    const productName = optionalText(item.item_name);
    const variationName = optionalText(item.model_name);
    return {
      ...(externalItemId ? { externalItemId } : {}),
      ...(sellerSku ? { sellerSku } : {}),
      ...(platformSku ? { platformSku } : {}),
      ...(productName ? { productName } : {}),
      ...(variationName ? { variationName } : {}),
      ...(item.model_quantity_purchased !== null && item.model_quantity_purchased !== undefined ? { quantity: item.model_quantity_purchased } : {}),
      ...(unitPrice ? { unitPrice } : {}),
    };
  }
}
