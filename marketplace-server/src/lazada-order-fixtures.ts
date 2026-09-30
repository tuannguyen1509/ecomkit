/** Sanitized, official-shaped fixtures. They contain no real customer or credential data. */
export const LAZADA_GET_ORDERS_FIXTURE = {
  code: "0", request_id: "fixture-request-orders", data: { count: "3", countTotal: "3", orders: [
    { order_id: "491253082180001", order_number: "491253082180001", created_at: "2018-02-09T22:44:30+08:00", updated_at: "2018-02-09T23:00:00+08:00", statuses: ["pending"], items_count: "1", price: "106.00", payment_method: "COD", address_shipping: { first_name: "T***", phone: "09****123", address1: "***" } },
    { order_id: "9007199254740993", order_number: "9007199254740993", created_at: "2018-02-10T08:00:00+07:00", updated_at: "2018-02-10T09:00:00+07:00", statuses: ["ready_to_ship", "shipped"], items_count: "2", address_shipping: { first_name: "***", phone: "***" } },
    { order_id: "491253082180003", created_at: "2018-02-10T10:00:00Z", updated_at: "2018-02-10T10:30:00Z", statuses: [], items_count: "0" },
  ] },
} as const;

export const LAZADA_GET_ORDER_FIXTURE = { code: "0", request_id: "fixture-request-order", data: LAZADA_GET_ORDERS_FIXTURE.data.orders[0] } as const;

export const LAZADA_GET_ORDER_ITEMS_FIXTURE = { code: "0", request_id: "fixture-request-items", data: [
  { order_item_id: "9007199254741001", order_id: "9007199254740993", status: "ready_to_ship", created_at: "2018-02-10T08:00:00+07:00", updated_at: "2018-02-10T09:00:00+07:00", sku: "SAME-SKU", shop_sku: "SAME-SHOP-SKU", name: "Synthetic item", item_price: "10.00", paid_price: "9.00", shipping_amount: "1.00", voucher_amount: "1.00", tax_amount: "0.00", currency: "VND", package_id: "PKG-1", tracking_code: "" },
  { order_item_id: "9007199254741002", order_id: "9007199254740993", status: "shipped", created_at: "2018-02-10T08:00:00+07:00", updated_at: "2018-02-10T09:05:00+07:00", sku: "SAME-SKU", shop_sku: "SAME-SHOP-SKU", name: "Synthetic item", item_price: "10.00", paid_price: "9.00", shipping_amount: "1.00", voucher_amount: "1.00", tax_amount: "0.00", currency: "VND", package_id: "PKG-2", tracking_code: "TRACK-2" },
] } as const;

export const LAZADA_GET_MULTIPLE_ORDER_ITEMS_FIXTURE = { code: "0", request_id: "fixture-request-multiple", data: [
  { order_id: "9007199254740993", order_number: "9007199254740993", order_items: LAZADA_GET_ORDER_ITEMS_FIXTURE.data },
] } as const;
