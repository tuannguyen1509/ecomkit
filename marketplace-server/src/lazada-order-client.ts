import type { LazadaAccessCredential } from "./lazada-credential-lifecycle.js";
import type { LazadaHttpClientCore, LazadaLowLevelRequest, LazadaResponseEnvelope } from "./lazada-http-client-core.js";
import {
  LAZADA_GET_ORDERS_LIMIT_MAX,
  LAZADA_GET_ORDERS_OFFSET_MAX,
  LAZADA_MULTIPLE_ORDER_ITEMS_MAX,
  LAZADA_ORDER_ENDPOINTS,
  parseLazadaGetOrderEnvelope,
  parseLazadaGetOrderItemsEnvelope,
  parseLazadaGetOrdersEnvelope,
  parseLazadaGetMultipleOrderItemsEnvelope,
  type LazadaGetOrdersData,
  type LazadaMultipleOrderItemsGroup,
  type LazadaRawOrder,
  type LazadaRawOrderItem,
} from "./lazada-order-contract.js";

export type LazadaOrderQueryMode = "CREATE_TIME" | "UPDATE_TIME";
export type LazadaOrderWindow = Readonly<{ mode: LazadaOrderQueryMode; from: string; to: string }>;
export type LazadaListOrdersInput = Readonly<{
  connectionId: string;
  window: LazadaOrderWindow;
  status?: string;
  limit?: number;
  offset?: number;
  sortDirection?: "ASC" | "DESC";
}>;
export type LazadaListOrdersPage = LazadaGetOrdersData & Readonly<{ requestId?: string; offset: number; limit: number }>;
export type LazadaListAllOrdersResult = Readonly<{ orders: readonly LazadaRawOrder[]; duplicateOrderIds: readonly string[]; requestIds: readonly string[]; countTotal?: number }>;

export interface LazadaAccessTokenLifecycle { ensureValidAccessToken(connectionId: string): Promise<LazadaAccessCredential>; }
export interface LazadaOrderHttpClient {
  request<T = unknown, TEnvelope extends LazadaResponseEnvelope<T> = LazadaResponseEnvelope<T>>(input: LazadaLowLevelRequest): Promise<Readonly<{ data: T | undefined; envelope: TEnvelope; requestId?: string }>>;
}

export class LazadaOrderClientError extends Error {
  constructor(public readonly code: "LAZADA_ORDER_INPUT_INVALID" | "LAZADA_WINDOW_TOO_LARGE" | "LAZADA_PAGINATION_NON_PROGRESS", public readonly retryable = false) {
    super(code); this.name = "LazadaOrderClientError";
  }
  toJSON(): object { return { name: this.name, code: this.code, retryable: this.retryable }; }
}

const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DECIMAL_ID = /^\d+$/;

function timestamp(value: string): string {
  if (!OFFSET_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) throw new LazadaOrderClientError("LAZADA_ORDER_INPUT_INVALID");
  return value;
}
function id(value: string): string {
  if (!DECIMAL_ID.test(value)) throw new LazadaOrderClientError("LAZADA_ORDER_INPUT_INVALID");
  return value;
}
function limit(value = LAZADA_GET_ORDERS_LIMIT_MAX): number {
  if (!Number.isInteger(value) || value <= 0 || value > LAZADA_GET_ORDERS_LIMIT_MAX) throw new LazadaOrderClientError("LAZADA_ORDER_INPUT_INVALID");
  return value;
}
function offset(value = 0): number {
  if (!Number.isInteger(value) || value < 0 || value > LAZADA_GET_ORDERS_OFFSET_MAX) throw new LazadaOrderClientError("LAZADA_ORDER_INPUT_INVALID");
  return value;
}

export class LazadaOrderClient {
  constructor(private readonly http: LazadaOrderHttpClient, private readonly credentials: LazadaAccessTokenLifecycle) {}

  async listOrders(input: LazadaListOrdersInput): Promise<LazadaListOrdersPage> {
    const pageLimit = limit(input.limit), pageOffset = offset(input.offset);
    const from = timestamp(input.window.from), to = timestamp(input.window.to);
    const params: Record<string, string | number> = {
      limit: pageLimit, offset: pageOffset,
      sort_by: input.window.mode === "CREATE_TIME" ? "created_at" : "updated_at",
      sort_direction: input.sortDirection ?? "ASC",
      ...(input.status ? { status: input.status } : {}),
      ...(input.window.mode === "CREATE_TIME"
        ? { created_after: from, created_before: to }
        : input.window.mode === "UPDATE_TIME"
          ? { update_after: from, update_before: to }
          : (() => { throw new LazadaOrderClientError("LAZADA_ORDER_INPUT_INVALID"); })()),
    };
    const access = await this.credentials.ensureValidAccessToken(input.connectionId);
    const response = await this.http.request({ operation: "listOrders", target: "VIETNAM", apiPath: LAZADA_ORDER_ENDPOINTS.getOrders, method: "GET", params, accessToken: access.accessToken });
    const parsed = parseLazadaGetOrdersEnvelope(response.envelope);
    return { ...parsed, offset: pageOffset, limit: pageLimit, ...(response.requestId ? { requestId: response.requestId } : {}) };
  }

  async listAllOrdersInWindow(input: Omit<LazadaListOrdersInput, "offset">): Promise<LazadaListAllOrdersResult> {
    const pageLimit = limit(input.limit);
    let pageOffset = 0;
    let total: number | undefined;
    const orders = new Map<string, LazadaRawOrder>();
    const duplicates = new Set<string>();
    const requestIds: string[] = [];
    for (;;) {
      const page = await this.listOrders({ ...input, limit: pageLimit, offset: pageOffset });
      if (page.requestId) requestIds.push(page.requestId);
      if (page.countTotal !== undefined) total = page.countTotal;
      let added = 0;
      for (const order of page.orders) {
        if (orders.has(order.order_id)) duplicates.add(order.order_id);
        else { orders.set(order.order_id, order); added++; }
      }
      const expectedMore = total !== undefined ? pageOffset + page.orders.length < total : page.orders.length === pageLimit;
      if (!expectedMore) break;
      if (page.orders.length === 0 || added === 0) throw new LazadaOrderClientError("LAZADA_PAGINATION_NON_PROGRESS");
      const nextOffset = pageOffset + pageLimit;
      if (nextOffset > LAZADA_GET_ORDERS_OFFSET_MAX) throw new LazadaOrderClientError("LAZADA_WINDOW_TOO_LARGE");
      pageOffset = nextOffset;
    }
    return { orders: [...orders.values()], duplicateOrderIds: [...duplicates], requestIds, ...(total !== undefined ? { countTotal: total } : {}) };
  }

  async getOrder(connectionId: string, orderId: string): Promise<Readonly<{ order: LazadaRawOrder; requestId?: string }>> {
    const response = await this.sellerRequest(connectionId, { operation: "getOrder", target: "VIETNAM", apiPath: LAZADA_ORDER_ENDPOINTS.getOrder, method: "GET", params: { order_id: id(orderId) } });
    return { order: parseLazadaGetOrderEnvelope(response.envelope), ...(response.requestId ? { requestId: response.requestId } : {}) };
  }

  async getOrderItems(connectionId: string, orderId: string): Promise<Readonly<{ items: readonly LazadaRawOrderItem[]; requestId?: string }>> {
    const response = await this.sellerRequest(connectionId, { operation: "getOrderItems", target: "VIETNAM", apiPath: LAZADA_ORDER_ENDPOINTS.getOrderItems, method: "GET", params: { order_id: id(orderId) } });
    return { items: parseLazadaGetOrderItemsEnvelope(response.envelope), ...(response.requestId ? { requestId: response.requestId } : {}) };
  }

  async getMultipleOrderItems(connectionId: string, orderIds: readonly string[]): Promise<Readonly<{ groups: readonly LazadaMultipleOrderItemsGroup[]; requestedOrderIds: readonly string[]; requestId?: string }>> {
    const unique = [...new Set(orderIds.map(id))];
    if (unique.length === 0 || unique.length > LAZADA_MULTIPLE_ORDER_ITEMS_MAX) throw new LazadaOrderClientError("LAZADA_ORDER_INPUT_INVALID");
    const response = await this.sellerRequest(connectionId, { operation: "getMultipleOrderItems", target: "VIETNAM", apiPath: LAZADA_ORDER_ENDPOINTS.getMultipleOrderItems, method: "GET", params: { order_ids: `[${unique.join(",")}]` } });
    return { groups: parseLazadaGetMultipleOrderItemsEnvelope(response.envelope), requestedOrderIds: unique, ...(response.requestId ? { requestId: response.requestId } : {}) };
  }

  private async sellerRequest(connectionId: string, request: LazadaLowLevelRequest) {
    const access = await this.credentials.ensureValidAccessToken(connectionId);
    return this.http.request({ ...request, accessToken: access.accessToken });
  }
}

export function createLazadaOrderClient(http: LazadaHttpClientCore, credentials: LazadaAccessTokenLifecycle): LazadaOrderClient { return new LazadaOrderClient(http, credentials); }
