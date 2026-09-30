import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { LazadaOAuthStateStore } from "./lazada-oauth-state.store.js";
import { MarketplaceOAuthStateStore } from "./marketplace-oauth-state.store.js";
import type { ShopeeOAuthStateContext } from "./shopee-oauth-state.store.js";

const lazada = new LazadaOAuthStateStore();
const shopee = new MarketplaceOAuthStateStore<ShopeeOAuthStateContext>("SHOPEE");
const lazadaContext = { platform: "LAZADA" as const, initiatingUserId: "synthetic-admin", region: "VN" as const, redirectUri: "http://localhost:3001/api/marketplaces/lazada/oauth/callback", createdAt: new Date(0).toISOString() };
const shopeeContext: ShopeeOAuthStateContext = { platform: "SHOPEE", initiatingUserId: "synthetic-admin", environment: "sandbox", redirectUri: "http://localhost:3001/api/marketplaces/shopee/oauth/callback", createdAt: new Date(0).toISOString() };

try {
  const state = randomBytes(32).toString("base64url");
  await lazada.save(state, lazadaContext, 60);
  assert.deepEqual(await lazada.consume(state), lazadaContext);
  assert.equal(await lazada.consume(state), null, "Lazada state must be single-use");

  const providerBound = randomBytes(32).toString("base64url");
  await shopee.save(providerBound, shopeeContext, 60);
  assert.equal(await lazada.consume(providerBound), null, "Lazada must not consume Shopee state");
  assert.deepEqual(await shopee.consume(providerBound), shopeeContext, "Shopee state remains available to Shopee");

  const expiring = randomBytes(32).toString("base64url");
  await lazada.save(expiring, lazadaContext, 1);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(await lazada.consume(expiring), null, "Lazada state TTL must expire");
  console.log("Lazada OAuth Redis state tests passed");
} finally {
  await Promise.all([lazada.onModuleDestroy(), shopee.onModuleDestroy()]);
}
