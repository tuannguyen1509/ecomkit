import { strict as assert } from "node:assert";
import { ShopeeNormalizationError, ShopeeNormalizer, type ShopeeOrderDetailForNormalization } from "./shopee-normalizer.js";

const fixture = (): ShopeeOrderDetailForNormalization => ({
  order_sn: "TEST-ORDER-AbC-001", order_status: "COMPLETED", create_time: 1_700_000_000, update_time: 1_700_000_100, currency: "VND", total_amount: 999_999,
  cod: 0, payment_method: "TEST_PAYMENT", shipping_carrier: "TEST_CARRIER", buyer_username: "T***_BUYER", message_to_seller: "TEST_NOTE",
  recipient_address: { name: "N*** A", phone: "09***123", full_address: "T*** address" },
  item_list: [
    { order_item_id: 101, item_id: 1, item_name: "Synthetic A", item_sku: "ITEM-SKU-A", model_id: 11, model_name: "Model A", model_sku: "MODEL-SKU-A", model_quantity_purchased: 2, model_original_price: 800_000, model_discounted_price: 700_000 },
    { line_item_id: 202, item_name: "Synthetic B", model_quantity_purchased: 3 },
  ],
});

const normalizer = new ShopeeNormalizer();
const source = fixture();
const before = JSON.stringify(source);
const normalized = normalizer.normalize(source);
assert.equal(normalized.platform, "SHOPEE"); assert.equal(normalized.marketplaceOrderId, "TEST-ORDER-AbC-001"); assert.equal(normalized.rawOrderCode, "TEST-ORDER-AbC-001");
assert.equal(normalized.rawProviderStatus, "COMPLETED"); assert.equal(normalized.providerCreatedAt, "2023-11-14T22:13:20.000Z"); assert.equal(normalized.providerUpdatedAt, "2023-11-14T22:15:00.000Z"); assert.equal(normalized.currency, "VND");
assert.equal(normalized.providerMetadata?.totalAmount, 999_999); assert.equal(normalized.providerMetadata?.recipientAddress && JSON.stringify(normalized.providerMetadata.recipientAddress), JSON.stringify(source.recipient_address));
assert.deepEqual(normalized.items, [{ externalItemId: "101", sellerSku: "MODEL-SKU-A", platformSku: "ITEM-SKU-A", productName: "Synthetic A", variationName: "Model A", quantity: 2, unitPrice: "700000" }, { externalItemId: "202", productName: "Synthetic B", quantity: 3 }]);
assert.equal(JSON.stringify(source), before, "normalization must not mutate provider input");
const roundTrip = JSON.parse(JSON.stringify(normalized)); assert.equal(roundTrip.marketplaceOrderId, source.order_sn); assert.equal(roundTrip.items[0].unitPrice, "700000");
for (const marker of ["accessToken", "refreshToken", "partnerKey", "credentialEnvelope", "sign"]) assert.equal(JSON.stringify(normalized).includes(marker), false);

const unknown = normalizer.normalize({ ...fixture(), order_status: "FUTURE_STATUS_X" }); assert.equal(unknown.rawProviderStatus, "FUTURE_STATUS_X");
const missing = normalizer.normalize({ order_sn: "TEST-MISSING-OPTIONAL", update_time: 1_700_000_100, item_list: [] }); assert.deepEqual(missing.items, []); assert.equal(missing.currency, undefined);
for (const order of [{ ...fixture(), order_sn: undefined }, { ...fixture(), order_sn: null }, { ...fixture(), order_sn: "" }, { ...fixture(), order_sn: "   " }]) {
  assert.throws(() => normalizer.normalize(order), (error: unknown) => error instanceof ShopeeNormalizationError && error.code === "SHOPEE_NORMALIZATION_INVALID_ORDER_SN");
}
for (const order of [{ ...fixture(), update_time: undefined }, { ...fixture(), update_time: -1 }, { ...fixture(), update_time: 1.5 }]) {
  assert.throws(() => normalizer.normalize(order), (error: unknown) => error instanceof ShopeeNormalizationError && error.code === "SHOPEE_NORMALIZATION_INVALID_TIMESTAMP");
}
assert.throws(() => normalizer.normalize({ ...fixture(), item_list: [{ item_name: "Masked fixture", model_quantity_purchased: 1.5 }] }), (error: unknown) => error instanceof ShopeeNormalizationError && error.code === "SHOPEE_NORMALIZATION_INVALID_ITEM");
try { normalizer.normalize({ ...fixture(), update_time: -1 }); } catch (error) { assert.ok(error instanceof ShopeeNormalizationError); assert.equal(JSON.stringify(error.toJSON()).includes("09***123"), false); }
console.log("Shopee normalizer contract tests passed");
