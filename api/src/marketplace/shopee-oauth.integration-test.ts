import { randomBytes } from "node:crypto";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ShopeeOAuthService } from "./shopee-oauth.service.js";
import type { ShopeeOAuthStateContext } from "./shopee-oauth-state.store.js";

type Stored = { value: ShopeeOAuthStateContext; expiresAt: number };
class MemoryStateStore {
  private readonly values = new Map<string, Stored>();
  async save(state: string, value: ShopeeOAuthStateContext, ttl: number): Promise<void> { this.values.set(state, { value, expiresAt: Date.now() + ttl * 1000 }); }
  async consume(state: string): Promise<ShopeeOAuthStateContext | null> { const current = this.values.get(state); this.values.delete(state); return current && current.expiresAt > Date.now() ? current.value : null; }
}
const markerAccess = "TEST_SHOPEE_ACCESS_TOKEN_SECRET";
const markerRefresh = "TEST_SHOPEE_REFRESH_TOKEN_SECRET";
const required = (value: string | null): string => { if (!value) throw new Error("expected value"); return value; };

async function run(): Promise<void> {
  process.env.SHOPEE_PARTNER_ID = "123456"; process.env.SHOPEE_PARTNER_KEY = "TEST_SHOPEE_PARTNER_KEY_SECRET"; process.env.SHOPEE_ENV = "sandbox"; process.env.SHOPEE_REDIRECT_URI = "http://localhost:3001/api/marketplaces/shopee/oauth/callback"; process.env.SHOPEE_OAUTH_STATE_TTL_SECONDS = "600"; process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const user = await prisma.user.findFirst({ select: { id: true } }); if (!user) throw new Error("no test user available");
  const states = new MemoryStateStore(); let calls = 0;
  const service = new ShopeeOAuthService(new MarketplaceCredentialService(), states as never, () => ({ requestPublic: async () => { calls++; return { request_id: "test-request", response: { access_token: markerAccess, refresh_token: markerRefresh, expire_in: 14400 } }; } }));
  const first = await service.start(user.id); const second = await service.start(user.id);
  const firstUrl = new URL(first.authorizationUrl); const secondUrl = new URL(second.authorizationUrl);
  if (firstUrl.origin !== "https://open.sandbox.test-stable.shopee.com" || firstUrl.pathname !== "/auth" || firstUrl.searchParams.get("auth_type") !== "seller" || firstUrl.searchParams.get("response_type") !== "code" || !firstUrl.searchParams.get("state") || firstUrl.searchParams.get("state") === secondUrl.searchParams.get("state") || first.authorizationUrl.includes("PARTNER_KEY")) throw new Error("authorization URL regression");
  const state = required(firstUrl.searchParams.get("state"));
  const result = await service.callback({ code: "TEST_CODE", shopId: "900001", state });
  if (result.status !== "ACTIVE" || result.externalShopId !== "900001" || calls !== 1) throw new Error("callback success regression");
  const row = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: "900001" } } });
  if (!row.credentialEnvelope || row.credentialEnvelope.includes(markerAccess) || row.credentialEnvelope.includes(markerRefresh)) throw new Error("credential plaintext regression");
  const credential = new MarketplaceCredentialService().decryptCredential(row.credentialEnvelope);
  if (credential.accessToken !== markerAccess || credential.refreshToken !== markerRefresh) throw new Error("credential decrypt regression");
  await service.callback({ code: "TEST_CODE", shopId: "900001", state }).then(() => { throw new Error("state replay accepted"); }, () => undefined);
  await prisma.marketplaceConnection.update({ where: { id: row.id }, data: { status: MarketplaceConnectionStatus.REAUTH_REQUIRED } });
  const reconnect = await service.start(user.id); await service.callback({ code: "TEST_CODE_2", shopId: "900001", state: required(new URL(reconnect.authorizationUrl).searchParams.get("state")) });
  const reconnected = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: row.id } }); if (reconnected.status !== MarketplaceConnectionStatus.ACTIVE) throw new Error("reauthorization regression");
  await service.callback({ mainAccountId: "1", state: "bad" }).then(() => { throw new Error("main account accepted"); }, () => undefined);
  await prisma.marketplaceConnection.delete({ where: { id: row.id } });
  console.log("Shopee OAuth offline integration test passed");
}
void run().catch((error) => { console.error(error instanceof Error ? error.message : "Shopee OAuth offline integration test failed"); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
