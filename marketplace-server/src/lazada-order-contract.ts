import type { LazadaResponseEnvelope } from "./lazada-http-client-core.js";

export const LAZADA_ORDER_ENDPOINTS = {
  getOrders: "/orders/get",
  getOrder: "/order/get",
  getOrderItems: "/order/items/get",
  getMultipleOrderItems: "/orders/items/get",
} as const;

export const LAZADA_GET_ORDERS_LIMIT_MAX = 100;
export const LAZADA_GET_ORDERS_OFFSET_MAX = 5000;
export const LAZADA_MULTIPLE_ORDER_ITEMS_MAX = 50;

export type LazadaGetOrdersParameters = Readonly<{
  created_after?: string;
  created_before?: string;
  update_after?: string;
  update_before?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sort_by?: "created_at" | "updated_at";
  sort_direction?: "ASC" | "DESC";
}>;

export type LazadaRawOrder = Readonly<Record<string, unknown> & {
  order_id: string;
  order_number?: string;
  created_at: string;
  updated_at: string;
  statuses: readonly string[];
}>;

export type LazadaRawOrderItem = Readonly<Record<string, unknown> & {
  order_item_id: string;
  order_id: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}>;

export type LazadaGetOrdersData = Readonly<{ count: number; countTotal?: number; orders: readonly LazadaRawOrder[] }>;
export type LazadaMultipleOrderItemsGroup = Readonly<Record<string, unknown> & { order_id: string; order_number?: string; order_items: readonly LazadaRawOrderItem[] }>;

export class LazadaOrderContractError extends Error {
  readonly retryable = false;
  constructor(public readonly code: "LAZADA_ORDER_RESPONSE_INVALID") { super(code); this.name = "LazadaOrderContractError"; }
  toJSON(): object { return { name: this.name, code: this.code, retryable: false }; }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

function providerId(value: unknown): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return value;
}

function optionalId(value: unknown): string | undefined { return value === undefined || value === null ? undefined : providerId(value); }
function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return parsed;
}

export function parseLazadaRawOrder(value: unknown): LazadaRawOrder {
  const source = record(value);
  if (!Array.isArray(source.statuses) || !source.statuses.every((status) => typeof status === "string")) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return {
    ...source,
    order_id: providerId(source.order_id),
    ...(optionalId(source.order_number) ? { order_number: optionalId(source.order_number) } : {}),
    created_at: requiredString(source.created_at),
    updated_at: requiredString(source.updated_at),
    statuses: [...source.statuses] as string[],
  } as LazadaRawOrder;
}

export function parseLazadaRawOrderItem(value: unknown): LazadaRawOrderItem {
  const source = record(value);
  return {
    ...source,
    order_item_id: providerId(source.order_item_id),
    order_id: providerId(source.order_id),
    status: requiredString(source.status),
    ...(source.created_at === undefined || source.created_at === null ? {} : { created_at: requiredString(source.created_at) }),
    ...(source.updated_at === undefined || source.updated_at === null ? {} : { updated_at: requiredString(source.updated_at) }),
  } as LazadaRawOrderItem;
}

export function parseLazadaGetOrdersEnvelope(envelope: LazadaResponseEnvelope): LazadaGetOrdersData {
  const data = record(envelope.data);
  if (!Array.isArray(data.orders)) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return {
    count: nonNegativeInteger(data.count),
    ...(data.countTotal === undefined || data.countTotal === null ? {} : { countTotal: nonNegativeInteger(data.countTotal) }),
    orders: data.orders.map(parseLazadaRawOrder),
  };
}

export function parseLazadaGetOrderEnvelope(envelope: LazadaResponseEnvelope): LazadaRawOrder { return parseLazadaRawOrder(envelope.data); }

export function parseLazadaGetOrderItemsEnvelope(envelope: LazadaResponseEnvelope): readonly LazadaRawOrderItem[] {
  if (!Array.isArray(envelope.data)) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return envelope.data.map(parseLazadaRawOrderItem);
}

export function parseLazadaGetMultipleOrderItemsEnvelope(envelope: LazadaResponseEnvelope): readonly LazadaMultipleOrderItemsGroup[] {
  if (!Array.isArray(envelope.data)) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
  return envelope.data.map((value) => {
    const source = record(value);
    if (!Array.isArray(source.order_items)) throw new LazadaOrderContractError("LAZADA_ORDER_RESPONSE_INVALID");
    return {
      ...source,
      order_id: providerId(source.order_id),
      ...(optionalId(source.order_number) ? { order_number: optionalId(source.order_number) } : {}),
      order_items: source.order_items.map(parseLazadaRawOrderItem),
    } as LazadaMultipleOrderItemsGroup;
  });
}
