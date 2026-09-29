import assert from "node:assert/strict";
import { getShopeeAuthorizationBaseUrl, getShopeeBaseUrl } from "./shopee-http-client.js";
import { inspectShopeeOperationalReadiness } from "./shopee-readiness.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const now = new Date("2026-09-29T01:02:03.456Z");
const secrets = ["TEST_PARTNER_ID", "TEST_PARTNER_KEY_SECRET", "TEST_ACCESS_TOKEN_SECRET", "TEST_REFRESH_TOKEN_SECRET", "TEST_ENCRYPTION_KEY_SECRET"];

assert.equal(getShopeeAuthorizationBaseUrl("production"), "https://open.shopee.com");
assert.equal(getShopeeBaseUrl("production"), "https://partner.shopeemobile.com");
assert.equal(getShopeeAuthorizationBaseUrl("sandbox"), "https://open.sandbox.test-stable.shopee.com");
assert.equal(getShopeeBaseUrl("sandbox"), "https://openplatform.sandbox.test-stable.shopee.sg");

const ready = inspectShopeeOperationalReadiness({
  SHOPEE_ENV: "production", SHOPEE_PARTNER_ID: secrets[0], SHOPEE_PARTNER_KEY: secrets[1],
  SHOPEE_REDIRECT_URI: "https://ecom.vuikhoe.vn/api/marketplaces/shopee/oauth/callback", MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
}, { redisAvailable: true, now });
assert.deepEqual(ready, {
  environment: "production", environmentConfigured: true, environmentValid: true, partnerIdPresent: true, partnerKeyPresent: true,
  callbackConfigured: true, callbackValid: true, encryptionKeyValid: true, redisAvailable: true,
  currentServerUtc: now.toISOString(), currentUnixSeconds: 1_790_643_723, readyForOAuth: true,
});
const serialized = JSON.stringify(ready); for (const secret of secrets) assert.ok(!serialized.includes(secret)); assert.ok(!serialized.includes(encryptionKey));

const absent = inspectShopeeOperationalReadiness({}, { now });
assert.equal(absent.environment, "sandbox"); assert.equal(absent.environmentConfigured, false); assert.equal(absent.readyForOAuth, false);
assert.equal(inspectShopeeOperationalReadiness({ SHOPEE_ENV: "invalid" }, { now }).environmentValid, false);
assert.equal(inspectShopeeOperationalReadiness({ SHOPEE_ENV: "production", SHOPEE_REDIRECT_URI: "http://ecom.vuikhoe.vn/callback" }, { now }).callbackValid, false);
assert.equal(inspectShopeeOperationalReadiness({ MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") }, { now }).encryptionKeyValid, false);
console.log("Shopee operational readiness tests passed");
