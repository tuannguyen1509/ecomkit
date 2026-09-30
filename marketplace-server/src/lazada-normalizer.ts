import type { NormalizedMarketplaceOrder, NormalizedMarketplaceOrderItem } from "@ecomkit/shared";
import type { LazadaRawOrder, LazadaRawOrderItem } from "./lazada-order-contract.js";

export type LazadaNormalizedMarketplaceOrder = NormalizedMarketplaceOrder & Readonly<{ platform: "LAZADA"; rawOrderCode: string }>;
export const LAZADA_CANONICAL_24_COLUMN_MAPPING = [
  ["Ngày Lên Đơn", "order.created_at", "DIRECT"], ["Mã đơn ESHOP", "NONE", "NULL"], ["Mã đơn sàn", "order.order_id", "STRING_PRESERVE"],
  ["Kênh Bán Hàng", "platform=LAZADA", "DIRECT"], ["Trạng Thái Đơn Hàng", "order.statuses[0] only when one distinct status", "DIRECT"],
  ["Tên Khách Hàng", "NONE", "NULL"], ["SĐT", "order.address_shipping.phone", "DIRECT"], ["Địa Chỉ", "NONE", "NULL"],
  ["Tỉnh/TP", "order.address_shipping.city", "DIRECT"], ["Ngày Xuất VAT", "NONE", "NULL"], ["Ghi Chú", "order.buyer_note", "DIRECT"],
  ["Đã Thu Tiền", "NONE", "NULL"], ["Trạng Thái Công Nợ", "NONE", "NULL"], ["Chênh lệch", "NONE", "NULL"],
  ["Giá SP (VAT 8%)", "NONE", "NULL"], ["% Tổng Chi Phí", "NONE", "NULL"], ["Tổng Tiền Sẽ Thu", "NONE", "NULL"],
  ["Phí Affiliate (Vui Khỏe)", "NONE", "NULL"], ["Chiết Khấu (Vui Khỏe)", "NONE", "NULL"], ["% Chiết Khấu Vui Khỏe", "NONE", "NULL"],
  ["Phí Cố Định (TMĐT)", "NONE", "NULL"], ["Phí dịch vụ (TMĐT)", "NONE", "NULL"], ["Phí Giao Dịch (TMĐT)", "NONE", "NULL"],
  ["% Chi Phí Sàn TMĐT", "NONE", "NULL"],
] as const;
export type LazadaNormalizationErrorCode =
  | "LAZADA_NORMALIZATION_ORDER_ID_INVALID"
  | "LAZADA_NORMALIZATION_ITEM_ID_INVALID"
  | "LAZADA_NORMALIZATION_ITEM_ORDER_MISMATCH"
  | "LAZADA_NORMALIZATION_DUPLICATE_ITEM"
  | "LAZADA_NORMALIZATION_TIMESTAMP_INVALID"
  | "LAZADA_NORMALIZATION_VALUE_INVALID";

export class LazadaNormalizationError extends Error {
  readonly retryable = false;
  constructor(public readonly code: LazadaNormalizationErrorCode, public readonly field: string) {
    super(`Lazada normalization failed for ${field}.`);
    this.name = "LazadaNormalizationError";
  }
  toJSON(): object { return { name: this.name, code: this.code, field: this.field, retryable: false }; }
}

const DECIMAL_ID = /^\d+$/;
const DECIMAL_VALUE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
function exactId(value: unknown, code: LazadaNormalizationErrorCode, field: string): string {
  if (typeof value !== "string" || !DECIMAL_ID.test(value)) throw new LazadaNormalizationError(code, field);
  return value;
}
function optionalText(value: unknown): string | undefined { return typeof value === "string" && value.length ? value : undefined; }
function optionalMoney(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if ((typeof value !== "string" && typeof value !== "number") || !DECIMAL_VALUE.test(String(value)) || (typeof value === "number" && !Number.isFinite(value))) {
    throw new LazadaNormalizationError("LAZADA_NORMALIZATION_VALUE_INVALID", field);
  }
  return String(value);
}
function providerTimestamp(value: unknown, field: "created_at" | "updated_at"): string {
  if (typeof value !== "string" || !value.length) throw new LazadaNormalizationError("LAZADA_NORMALIZATION_TIMESTAMP_INVALID", field);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new LazadaNormalizationError("LAZADA_NORMALIZATION_TIMESTAMP_INVALID", field);
  return new Date(time).toISOString();
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class LazadaNormalizer {
  normalize(input: Readonly<{ order: LazadaRawOrder; items: readonly LazadaRawOrderItem[] }>): LazadaNormalizedMarketplaceOrder {
    const orderId = exactId(input.order.order_id, "LAZADA_NORMALIZATION_ORDER_ID_INVALID", "order.order_id");
    const providerStatuses = [...new Set(input.order.statuses)];
    if (!providerStatuses.every((status) => typeof status === "string" && status.length > 0)) throw new LazadaNormalizationError("LAZADA_NORMALIZATION_VALUE_INVALID", "order.statuses");
    const seen = new Set<string>();
    const itemStatuses: Array<{ orderItemId: string; status: string }> = [];
    const items = input.items.map((item, index) => {
      const normalized = this.normalizeItem(item, orderId, index);
      if (seen.has(normalized.externalItemId!)) throw new LazadaNormalizationError("LAZADA_NORMALIZATION_DUPLICATE_ITEM", "items.order_item_id");
      seen.add(normalized.externalItemId!);
      itemStatuses.push({ orderItemId: normalized.externalItemId!, status: item.status });
      return normalized;
    });
    const providerCreatedAt = providerTimestamp(input.order.created_at, "created_at");
    const providerUpdatedAt = providerTimestamp(input.order.updated_at, "updated_at");
    const metadata: Record<string, unknown> = { providerStatuses, itemStatuses };
    const moneyFields = [["totalAmount", "price"], ["shippingFee", "shipping_fee"], ["voucherAmount", "voucher"]] as const;
    for (const [target, source] of moneyFields) { const value = optionalMoney(input.order[source], `order.${source}`); if (value !== undefined) metadata[target] = value; }
    for (const [target, source] of [["paymentMethod", "payment_method"], ["customerFirstName", "customer_first_name"], ["customerLastName", "customer_last_name"], ["buyerNote", "buyer_note"]] as const) {
      const value = optionalText(input.order[source]); if (value !== undefined) metadata[target] = value;
    }
    if (input.order.address_shipping && typeof input.order.address_shipping === "object") metadata.shippingAddress = clone(input.order.address_shipping);
    if (input.order.address_billing && typeof input.order.address_billing === "object") metadata.billingAddress = clone(input.order.address_billing);
    return {
      platform: "LAZADA", marketplaceOrderId: orderId, rawOrderCode: orderId,
      ...(providerStatuses.length === 1 ? { rawProviderStatus: providerStatuses[0] } : {}),
      providerCreatedAt, providerUpdatedAt, items, providerMetadata: metadata,
    };
  }

  private normalizeItem(item: LazadaRawOrderItem, parentOrderId: string, index: number): NormalizedMarketplaceOrderItem {
    const itemId = exactId(item.order_item_id, "LAZADA_NORMALIZATION_ITEM_ID_INVALID", `items[${index}].order_item_id`);
    const itemOrderId = exactId(item.order_id, "LAZADA_NORMALIZATION_ORDER_ID_INVALID", `items[${index}].order_id`);
    if (itemOrderId !== parentOrderId) throw new LazadaNormalizationError("LAZADA_NORMALIZATION_ITEM_ORDER_MISMATCH", `items[${index}].order_id`);
    if (typeof item.status !== "string" || !item.status.length) throw new LazadaNormalizationError("LAZADA_NORMALIZATION_VALUE_INVALID", `items[${index}].status`);
    const unitPrice = optionalMoney(item.paid_price, `items[${index}].paid_price`);
    const sellerSku = optionalText(item.shop_sku), platformSku = optionalText(item.sku), productName = optionalText(item.name), variationName = optionalText(item.variation);
    return { externalItemId: itemId, ...(sellerSku ? { sellerSku } : {}), ...(platformSku ? { platformSku } : {}), ...(productName ? { productName } : {}), ...(variationName ? { variationName } : {}), quantity: 1, ...(unitPrice !== undefined ? { unitPrice } : {}) };
  }
}
