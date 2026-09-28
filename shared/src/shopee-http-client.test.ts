import { strict as assert } from "node:assert";
import {
  getShopeeBaseUrl,
  hmacSha256Hex,
  loadShopeeRuntimeConfig,
  ShopeeConfigError,
  ShopeeHttpClient,
  ShopeeHttpError,
  ShopeeSigner
} from "./shopee-http-client";

const partnerId = "123456";
const partnerKey = "TEST_SHOPEE_PARTNER_KEY_SECRET";
const accessToken = "TEST_SHOPEE_ACCESS_TOKEN_SECRET";
const shopId = "987654";
const timestamp = 1_700_000_000;
const publicPath = "/api/v2/auth/token/get";
const shopPath = "/api/v2/order/get_order_list";
const signer = new ShopeeSigner(partnerId, partnerKey);

async function rejects(action: () => Promise<unknown>, check: (error: unknown) => boolean): Promise<void> {
  await assert.rejects(action, check);
}

async function run(): Promise<void> {
  assert.equal(hmacSha256Hex(Buffer.alloc(20, 0x0b), "Hi There"), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7", "RFC 4231 vector");
  assert.equal(signer.publicBaseString(publicPath, timestamp), `${partnerId}${publicPath}${timestamp}`);
  assert.equal(signer.signPublic(publicPath, timestamp), "ae8f62702398d0dea61b6314ed98a867853028dfb1aa38af6f98a150a3d35788");
  assert.equal(signer.shopBaseString(shopPath, timestamp, accessToken, shopId), `${partnerId}${shopPath}${timestamp}${accessToken}${shopId}`);
  const shopSignature = signer.signShop(shopPath, timestamp, accessToken, shopId);
  assert.match(shopSignature, /^[a-f0-9]{64}$/);
  assert.notEqual(shopSignature, signer.signShop(shopPath, timestamp, accessToken, "987655"));
  assert.notEqual(shopSignature, signer.signShop(shopPath, timestamp + 1, accessToken, shopId));
  assert.notEqual(shopSignature, signer.signShop(shopPath, timestamp, `${accessToken}x`, shopId));
  assert.notEqual(shopSignature, signer.signShop("https://partner.shopeemobile.com/api/v2/order/get_order_list", timestamp, accessToken, shopId));

  assert.equal(getShopeeBaseUrl("sandbox"), "https://openplatform.sandbox.test-stable.shopee.sg");
  assert.equal(getShopeeBaseUrl("production"), "https://partner.shopeemobile.com");
  assert.throws(() => loadShopeeRuntimeConfig({ SHOPEE_PARTNER_ID: partnerId, SHOPEE_PARTNER_KEY: partnerKey, SHOPEE_ENV: "invalid" }), (error: unknown) => error instanceof ShopeeConfigError && error.code === "SHOPEE_ENV_INVALID");

  const config = loadShopeeRuntimeConfig({ SHOPEE_PARTNER_ID: partnerId, SHOPEE_PARTNER_KEY: partnerKey, SHOPEE_ENV: "sandbox", SHOPEE_HTTP_TIMEOUT_MS: "1000" });
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fakeFetch = async (input: string | URL, init?: RequestInit) => {
    capturedUrl = String(input); capturedInit = init;
    return new Response(JSON.stringify({ request_id: "request-success", response: { ok: true } }), { status: 200 });
  };
  const client = new ShopeeHttpClient(config, fakeFetch, () => timestamp);
  const shopResponse = await client.requestShop({ operation: "LIST_ORDERS", apiPath: shopPath, accessToken, shopId, query: { time_from: 1, time_to: 2, page_size: 100 } });
  assert.equal(shopResponse.request_id, "request-success");
  const shopUrl = new URL(capturedUrl);
  assert.equal(shopUrl.origin, getShopeeBaseUrl("sandbox"));
  for (const key of ["partner_id", "timestamp", "access_token", "shop_id", "sign", "time_from", "time_to", "page_size"]) assert.ok(shopUrl.searchParams.has(key));
  assert.equal(shopUrl.searchParams.has("partner_key"), false);
  assert.equal(capturedInit?.method, "GET");

  await client.requestPublic({ operation: "GET_TOKEN", apiPath: publicPath, method: "POST", body: { code: "SYNTHETIC_CODE", partner_id: Number(partnerId), shop_id: Number(shopId) } });
  const tokenUrl = new URL(capturedUrl);
  assert.equal(tokenUrl.searchParams.has("access_token"), false);
  assert.equal(tokenUrl.searchParams.has("partner_key"), false);
  assert.equal(String(capturedInit?.body).includes(partnerKey), false);

  const structured = new ShopeeHttpClient(config, async () => new Response(JSON.stringify({ request_id: "request-error", error: "error_permission", message: "denied" }), { status: 200 }), () => timestamp);
  assert.equal((await structured.requestShop({ operation: "LIST", apiPath: shopPath, accessToken, shopId })).error, "error_permission");
  const http500 = new ShopeeHttpClient(config, async () => new Response(JSON.stringify({ request_id: "request-500", error: "error_server", message: "synthetic" }), { status: 500 }), () => timestamp);
  await rejects(() => http500.requestPublic({ operation: "TOKEN", apiPath: publicPath }), (error) => error instanceof ShopeeHttpError && error.safe.httpStatus === 500 && error.safe.requestId === "request-500");
  const invalidJson = new ShopeeHttpClient(config, async () => new Response("not-json", { status: 200 }), () => timestamp);
  await rejects(() => invalidJson.requestPublic({ operation: "TOKEN", apiPath: publicPath }), (error) => error instanceof ShopeeHttpError && error.message === "Shopee returned invalid JSON.");
  const timeout = new ShopeeHttpClient(config, async () => { throw new DOMException("synthetic", "TimeoutError"); }, () => timestamp);
  await rejects(() => timeout.requestShop({ operation: "LIST", apiPath: shopPath, accessToken, shopId }), (error) => error instanceof ShopeeHttpError && error.message === "Shopee request timed out.");
  const network = new ShopeeHttpClient(config, async () => { throw new Error("synthetic network"); }, () => timestamp);
  await rejects(() => network.requestShop({ operation: "LIST", apiPath: shopPath, accessToken, shopId }), (error) => {
    const value = JSON.stringify(error);
    return error instanceof ShopeeHttpError && !value.includes(partnerKey) && !value.includes(accessToken) && !value.includes("sign=") && !value.includes("?");
  });
  console.log("Shopee signing and HTTP client contract tests passed");
}

void run().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Shopee contract test failed"); process.exitCode = 1; });
