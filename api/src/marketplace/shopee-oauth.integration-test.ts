import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { ShopeeSigner } from "@ecomkit/shared";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ShopeeOAuthController } from "./shopee-oauth.controller.js";
import { ShopeeOAuthService } from "./shopee-oauth.service.js";
import type { ShopeeOAuthStateContext } from "./shopee-oauth-state.store.js";

type Stored = { value: ShopeeOAuthStateContext; expiresAt: number };
class MemoryStateStore {
  readonly values = new Map<string, Stored>();
  async save(state: string, value: ShopeeOAuthStateContext, ttl: number): Promise<void> { this.values.set(state, { value, expiresAt: Date.now() + ttl * 1000 }); }
  async consume(state: string): Promise<ShopeeOAuthStateContext | null> { const current = this.values.get(state); this.values.delete(state); return current && current.expiresAt > Date.now() ? current.value : null; }
  expire(state: string): void { const current = this.values.get(state); if (current) current.expiresAt = 0; }
}

const partnerKey = "TEST_SHOPEE_PARTNER_KEY_SECRET";
const authCode = "TEST_SHOPEE_AUTH_CODE_SECRET";
const accessToken = "TEST_SHOPEE_ACCESS_TOKEN_SECRET";
const refreshToken = "TEST_SHOPEE_REFRESH_TOKEN_SECRET";
const shopA = "91000601";
const shopB = "91000602";
const now = Date.UTC(2026, 9, 1, 3, 0, 0);
const required = (value: string | null): string => { if (!value) throw new Error("expected value"); return value; };
const rejectionCode = (error: unknown): string | undefined => {
  if (!(error instanceof BadRequestException)) return undefined;
  const body = error.getResponse();
  return typeof body === "object" && body && "errorCode" in body ? String(body.errorCode) : undefined;
};

async function run(): Promise<void> {
  const previous = { ...process.env };
  process.env.SHOPEE_PARTNER_ID = "123456";
  process.env.SHOPEE_PARTNER_KEY = partnerKey;
  process.env.SHOPEE_ENV = "sandbox";
  process.env.SHOPEE_REDIRECT_URI = "http://localhost:3001/api/marketplaces/shopee/oauth/callback";
  process.env.SHOPEE_OAUTH_STATE_TTL_SECONDS = "600";
  process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.WEB_ORIGIN = "http://localhost:3000";
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no test user available");
  const credentials = new MarketplaceCredentialService();
  const states = new MemoryStateStore();
  let calls = 0;
  let capturedBody: unknown;
  const service = new ShopeeOAuthService(credentials, states as never, () => ({ requestPublic: async (request) => { calls++; capturedBody = request.body; return { request_id: "test-request", response: { access_token: accessToken, refresh_token: refreshToken, expire_in: 14400 } }; } }), undefined, () => now);
  try {
    await prisma.marketplaceConnection.deleteMany({ where: { platform: Platform.SHOPEE, externalShopId: { in: [shopA, shopB] } } });
    const first = await service.start(user.id); const second = await service.start(user.id);
    const firstUrl = new URL(first.authorizationUrl); const secondUrl = new URL(second.authorizationUrl); const timestamp = Math.floor(now / 1000);
    assert.equal(firstUrl.origin, "https://openplatform.sandbox.test-stable.shopee.sg");
    assert.equal(firstUrl.pathname, "/api/v2/shop/auth_partner");
    assert.equal(firstUrl.searchParams.get("partner_id"), "123456");
    assert.equal(firstUrl.searchParams.get("timestamp"), String(timestamp));
    assert.equal(firstUrl.searchParams.get("redirect"), process.env.SHOPEE_REDIRECT_URI);
    assert.equal(firstUrl.searchParams.get("sign"), new ShopeeSigner("123456", partnerKey).signPublic("/api/v2/shop/auth_partner", timestamp));
    assert.notEqual(firstUrl.searchParams.get("state"), secondUrl.searchParams.get("state"));
    assert.ok(!first.authorizationUrl.includes(partnerKey)); assert.equal(calls, 0);

    const state = required(firstUrl.searchParams.get("state"));
    const result = await service.callback({ code: authCode, shopId: shopA, state });
    assert.equal(result.status, "ACTIVE"); assert.equal(result.externalShopId, shopA); assert.equal(calls, 1);
    assert.deepEqual(capturedBody, { code: authCode, partner_id: 123456, shop_id: Number(shopA) });
    const row = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: shopA } } });
    assert.ok(row.credentialEnvelope && !row.credentialEnvelope.includes(accessToken) && !row.credentialEnvelope.includes(refreshToken));
    const credential = credentials.decryptCredential(row.credentialEnvelope!);
    assert.equal(credential.accessToken, accessToken); assert.equal(credential.refreshToken, refreshToken);
    assert.equal(credential.tokenExpiresAt, new Date(now + 14_400_000).toISOString());
    assert.equal(credential.providerMetadata?.credentialSource, "OAUTH"); assert.equal(credential.providerMetadata?.refreshOwnership, "ECOMKIT");

    await assert.rejects(() => service.callback({ code: authCode, shopId: shopA, state }), (error) => rejectionCode(error) === "SHOPEE_OAUTH_STATE_INVALID");
    assert.equal(calls, 1);
    await assert.rejects(() => service.callback({ shopId: shopA, state: "missing-code" }), (error) => rejectionCode(error) === "SHOPEE_OAUTH_CALLBACK_INVALID");
    await assert.rejects(() => service.callback({ code: authCode, state: "missing-shop" }), (error) => rejectionCode(error) === "SHOPEE_OAUTH_CALLBACK_INVALID");
    assert.equal(calls, 1);
    const expiredStart = await service.start(user.id); const expiredState = required(new URL(expiredStart.authorizationUrl).searchParams.get("state")); states.expire(expiredState);
    await assert.rejects(() => service.callback({ code: authCode, shopId: shopA, state: expiredState }), (error) => rejectionCode(error) === "SHOPEE_OAUTH_STATE_INVALID"); assert.equal(calls, 1);

    await prisma.marketplaceConnection.update({ where: { id: row.id }, data: { credentialEnvelope: credentials.encryptCredential({ accessToken: "TEST_EXTERNAL_ACCESS_SECRET", tokenExpiresAt: new Date(now + 86_400_000).toISOString(), providerMetadata: { credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL", shopId: shopA } }), status: MarketplaceConnectionStatus.ACTIVE } });
    const failing = new ShopeeOAuthService(credentials, states as never, () => ({ requestPublic: async () => { calls++; throw new Error(`${partnerKey} ${authCode} ${accessToken} ${refreshToken}`); } }), undefined, () => now);
    const failedStart = await failing.start(user.id);
    await assert.rejects(() => failing.callback({ code: authCode, shopId: shopA, state: required(new URL(failedStart.authorizationUrl).searchParams.get("state")) }), (error: unknown) => { assert.ok(!JSON.stringify(error).includes("_SECRET")); return rejectionCode(error) === "SHOPEE_TOKEN_EXCHANGE_FAILED"; });
    const preserved = credentials.decryptCredential((await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: row.id } })).credentialEnvelope!);
    assert.equal(preserved.providerMetadata?.credentialSource, "EXTERNAL_IMPORT"); assert.equal(preserved.accessToken, "TEST_EXTERNAL_ACCESS_SECRET");

    const transitionStart = await service.start(user.id);
    await service.callback({ code: "TEST_TRANSITION_CODE", shopId: shopA, state: required(new URL(transitionStart.authorizationUrl).searchParams.get("state")) });
    const transitionedRows = await prisma.marketplaceConnection.findMany({ where: { platform: Platform.SHOPEE, externalShopId: shopA } });
    assert.equal(transitionedRows.length, 1); assert.equal(credentials.decryptCredential(transitionedRows[0]!.credentialEnvelope!).providerMetadata?.refreshOwnership, "ECOMKIT");
    const otherStart = await service.start(user.id);
    await service.callback({ code: "TEST_OTHER_CODE", shopId: shopB, state: required(new URL(otherStart.authorizationUrl).searchParams.get("state")) });
    assert.equal(await prisma.marketplaceConnection.count({ where: { platform: Platform.SHOPEE, externalShopId: { in: [shopA, shopB] } } }), 2);

    const controller = new ShopeeOAuthController({ callback: async () => ({}) } as never); let redirect = "";
    await controller.callback({ redirect: (value: string) => { redirect = value; return value; } } as never, authCode, shopA, "safe-state");
    assert.equal(redirect, "http://localhost:3000/marketplaces?shopeeOAuth=success"); assert.ok(!redirect.includes(authCode) && !redirect.includes(accessToken));
    const failureController = new ShopeeOAuthController({ callback: async () => { throw new BadRequestException({ errorCode: "SHOPEE_TOKEN_EXCHANGE_FAILED" }); } } as never);
    await failureController.callback({ redirect: (value: string) => { redirect = value; return value; } } as never, authCode, shopA, "safe-state");
    assert.equal(new URL(redirect).searchParams.get("code"), "SHOPEE_TOKEN_EXCHANGE_FAILED"); assert.ok(!redirect.includes(authCode) && !redirect.includes(accessToken));
    console.log("Shopee OAuth activation integration test passed");
  } finally {
    await prisma.marketplaceConnection.deleteMany({ where: { platform: Platform.SHOPEE, externalShopId: { in: [shopA, shopB] } } });
    for (const key of ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_ENV", "SHOPEE_REDIRECT_URI", "SHOPEE_OAUTH_STATE_TTL_SECONDS", "MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY", "WEB_ORIGIN"] as const) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

void run().catch((error) => { console.error(error instanceof Error ? error.message : "Shopee OAuth activation integration test failed"); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
