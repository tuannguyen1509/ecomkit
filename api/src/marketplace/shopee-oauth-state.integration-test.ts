import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ShopeeOAuthStateStore, type ShopeeOAuthStateContext } from "./shopee-oauth-state.store.js";

const store = new ShopeeOAuthStateStore();
const context: ShopeeOAuthStateContext = {
  platform: "SHOPEE", initiatingUserId: "synthetic-admin", environment: "sandbox",
  redirectUri: "http://localhost:3001/api/marketplaces/shopee/oauth/callback", createdAt: new Date().toISOString(),
};

try {
  const state = randomBytes(32).toString("base64url");
  await store.save(state, context, 60);
  assert.deepEqual(await store.consume(state), context);
  assert.equal(await store.consume(state), null, "OAuth state must be single-use");
  const expiring = randomBytes(32).toString("base64url");
  await store.save(expiring, context, 1);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(await store.consume(expiring), null, "OAuth state TTL must expire");
  console.log("Shopee OAuth Redis state readiness tests passed");
} finally { await store.onModuleDestroy(); }
