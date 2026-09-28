import type { ShopeeAccessCredential } from "./lifecycle-contracts.js";

export type ShopeeTimeRangeField = "create_time" | "update_time";
export type ShopeeOrderListItem = { order_sn?: string; order_status?: string; booking_sn?: string };
export type ShopeeOrderDetail = { order_sn?: string; region?: string; currency?: string; total_amount?: number; order_status?: string; create_time?: number; update_time?: number; recipient_address?: Record<string, unknown>; item_list?: Record<string, unknown>[]; [key: string]: unknown };
export type ShopeeOrderListInput = Readonly<{ timeRangeField: ShopeeTimeRangeField; timeFrom: number; timeTo: number; pageSize?: number; cursor?: string; orderStatus?: string; responseOptionalFields?: string; requestOrderStatusPending?: boolean }>;
export type ShopeeOrderDetailOptions = Readonly<{ responseOptionalFields?: string; requestOrderStatusPending?: boolean }>;
export type ShopeeOrderListPage = Readonly<{ orders: ShopeeOrderListItem[]; more: boolean; nextCursor?: string; requestId?: string }>;
export type ShopeeOrderDetailsResult = Readonly<{ orders: ShopeeOrderDetail[]; missingOrderSns: string[] }>;
export type ShopeeOrderTransport = {
  list(credential: ShopeeAccessCredential, input: Required<Pick<ShopeeOrderListInput, "timeRangeField" | "timeFrom" | "timeTo">> & { pageSize: number; cursor?: string; orderStatus?: string; responseOptionalFields?: string; requestOrderStatusPending?: boolean }): Promise<{ orders?: ShopeeOrderListItem[]; more?: boolean; nextCursor?: string; requestId?: string }>;
  details(credential: ShopeeAccessCredential, orderSns: readonly string[], options?: ShopeeOrderDetailOptions): Promise<{ orders?: ShopeeOrderDetail[]; requestId?: string }>;
};
export type ShopeeAccessCredentialProvider = { ensureValidAccessToken(connectionId: string): Promise<ShopeeAccessCredential> };
export class ShopeeOrderClientError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly requestId?: string) { super(code); this.name = "ShopeeOrderClientError"; }
  toJSON() { return { name: this.name, code: this.code, retryable: this.retryable, ...(this.requestId ? { requestId: this.requestId } : {}) }; }
}

const maxWindow = 15 * 86400;

function validateListInput(input: ShopeeOrderListInput): number {
  if (input.timeRangeField !== "create_time" && input.timeRangeField !== "update_time" || !Number.isInteger(input.timeFrom) || !Number.isInteger(input.timeTo) || input.timeFrom >= input.timeTo || input.timeTo - input.timeFrom > maxWindow) throw new ShopeeOrderClientError("SHOPEE_ORDER_INVALID_TIME_RANGE", false);
  const pageSize = input.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ShopeeOrderClientError("SHOPEE_ORDER_INVALID_PAGE_SIZE", false);
  return pageSize;
}

export function splitShopeeOrderWindows(timeFrom: number, timeTo: number): Array<{ timeFrom: number; timeTo: number }> {
  if (!Number.isInteger(timeFrom) || !Number.isInteger(timeTo) || timeFrom >= timeTo) throw new ShopeeOrderClientError("SHOPEE_ORDER_INVALID_TIME_RANGE", false);
  const result = [];
  for (let start = timeFrom; start < timeTo; start += maxWindow) result.push({ timeFrom: start, timeTo: Math.min(start + maxWindow, timeTo) });
  return result;
}
export function batchShopeeOrderSns(orderSns: readonly string[]): string[][] {
  if (!orderSns.length) throw new ShopeeOrderClientError("SHOPEE_ORDER_INVALID_ORDER_SN", false);
  return Array.from({ length: Math.ceil(orderSns.length / 50) }, (_, index) => [...orderSns.slice(index * 50, index * 50 + 50)]);
}

export class ShopeeOrderClientCore {
  constructor(private readonly credentials: ShopeeAccessCredentialProvider, private readonly transport: ShopeeOrderTransport) {}

  /** Exactly one provider request; continuation safety belongs to collection methods. */
  async listOrders(connectionId: string, input: ShopeeOrderListInput): Promise<ShopeeOrderListPage> {
    const pageSize = validateListInput(input);
    const credential = await this.credentials.ensureValidAccessToken(connectionId);
    const page = await this.transport.list(credential, { ...input, pageSize });
    const more = page.more === true;
    if (more && !page.nextCursor) throw new ShopeeOrderClientError("SHOPEE_ORDER_PAGINATION_INVALID", false, page.requestId);
    return { orders: page.orders ?? [], more, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), ...(page.requestId ? { requestId: page.requestId } : {}) };
  }

  async listAllInWindow(connectionId: string, input: Omit<ShopeeOrderListInput, "cursor">): Promise<ShopeeOrderListItem[]> {
    const all: ShopeeOrderListItem[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.listOrders(connectionId, { ...input, cursor });
      if (page.more && (!page.nextCursor || cursors.has(page.nextCursor))) throw new ShopeeOrderClientError("SHOPEE_ORDER_PAGINATION_INVALID", false, page.requestId);
      all.push(...page.orders);
      if (page.nextCursor) cursors.add(page.nextCursor);
      cursor = page.more ? page.nextCursor : undefined;
    } while (cursor);
    return all;
  }

  async collectOrderSns(connectionId: string, input: Omit<ShopeeOrderListInput, "cursor">): Promise<string[]> {
    if (input.timeRangeField !== "create_time" && input.timeRangeField !== "update_time" || !Number.isInteger(input.timeFrom) || !Number.isInteger(input.timeTo) || input.timeFrom >= input.timeTo) throw new ShopeeOrderClientError("SHOPEE_ORDER_INVALID_TIME_RANGE", false);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const window of splitShopeeOrderWindows(input.timeFrom, input.timeTo)) {
      const orders = await this.listAllInWindow(connectionId, { ...input, ...window });
      for (const item of orders) {
        if (typeof item.order_sn !== "string" || !item.order_sn) throw new ShopeeOrderClientError("SHOPEE_ORDER_INVALID_ORDER_SN", false);
        if (!seen.has(item.order_sn)) { seen.add(item.order_sn); ids.push(item.order_sn); }
      }
    }
    return ids;
  }

  /** API-compatible result: preserves provider order and explicitly reports missing details. */
  async getOrderDetails(connectionId: string, orderSns: readonly string[], options: ShopeeOrderDetailOptions = {}): Promise<ShopeeOrderDetailsResult> {
    if (!orderSns.length) return { orders: [], missingOrderSns: [] };
    const credential = await this.credentials.ensureValidAccessToken(connectionId);
    const received = new Map<string, ShopeeOrderDetail>();
    for (const batch of batchShopeeOrderSns(orderSns)) {
      const response = await this.transport.details(credential, batch, options);
      for (const detail of response.orders ?? []) {
        if (typeof detail.order_sn !== "string" || !detail.order_sn || received.has(detail.order_sn)) throw new ShopeeOrderClientError("SHOPEE_ORDER_DUPLICATE_DETAIL", false, response.requestId);
        received.set(detail.order_sn, detail);
      }
    }
    return { orders: [...received.values()], missingOrderSns: orderSns.filter((id) => !received.has(id)) };
  }

  /** Strict provider-adapter helper: no partial result or unrelated identity is accepted. */
  async getCompleteOrderDetails(connectionId: string, orderSns: readonly string[], options: ShopeeOrderDetailOptions = {}): Promise<ShopeeOrderDetail[]> {
    const result = await this.getOrderDetails(connectionId, orderSns, options);
    if (result.missingOrderSns.length) throw new ShopeeOrderClientError("SHOPEE_ORDER_MISSING_DETAIL", false);
    const requested = new Set(orderSns);
    if (result.orders.some((detail) => !detail.order_sn || !requested.has(detail.order_sn))) throw new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_INVALID_RESPONSE", false);
    return orderSns.map((id) => result.orders.find((detail) => detail.order_sn === id)!);
  }
}
