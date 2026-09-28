import { randomBytes } from "node:crypto";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ShopeeTokenService } from "./shopee-token.service.js";

const oldAccess = "TEST_SHOPEE_ACCESS_OLD", oldRefresh = "TEST_SHOPEE_REFRESH_OLD", newAccess = "TEST_SHOPEE_ACCESS_NEW", newRefresh = "TEST_SHOPEE_REFRESH_NEW";
async function run(): Promise<void> {
  process.env.SHOPEE_PARTNER_ID = "123456"; process.env.SHOPEE_PARTNER_KEY = "TEST_SHOPEE_PARTNER_KEY"; process.env.SHOPEE_ENV = "sandbox"; process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64"); process.env.SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = "300";
  const credentials = new MarketplaceCredentialService(); const shopId = "900002";
  const expired = new Date(Date.now() - 1000).toISOString(), refreshExpiry = new Date(Date.now() + 86400000).toISOString();
  const connection = await prisma.marketplaceConnection.upsert({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: shopId } }, create: { platform: Platform.SHOPEE, externalShopId: shopId, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: credentials.encryptCredential({ accessToken: oldAccess, refreshToken: oldRefresh, tokenExpiresAt: expired, refreshTokenExpiresAt: refreshExpiry, providerMetadata: { shopId } }) }, update: { status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: credentials.encryptCredential({ accessToken: oldAccess, refreshToken: oldRefresh, tokenExpiresAt: expired, refreshTokenExpiresAt: refreshExpiry, providerMetadata: { shopId } }) } });
  let calls = 0, receivedRefresh = "";
  const service = new ShopeeTokenService(credentials, () => ({ requestPublic: async (request) => { calls++; receivedRefresh = (request.body as { refresh_token: string }).refresh_token; return { response: { access_token: newAccess, refresh_token: newRefresh, expire_in: 14400 } }; } }));
  const [a, b] = await Promise.all([service.ensureValidAccessToken(connection.id), service.ensureValidAccessToken(connection.id)]);
  if (a.accessToken !== newAccess || b.accessToken !== newAccess || calls !== 1 || receivedRefresh !== oldRefresh) throw new Error("refresh race regression");
  const row = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connection.id } }); if (!row.credentialEnvelope || row.credentialEnvelope.includes(oldAccess) || row.credentialEnvelope.includes(newRefresh)) throw new Error("plaintext credential regression");
  const rotated = credentials.decryptCredential(row.credentialEnvelope); if (rotated.refreshToken !== newRefresh) throw new Error("refresh rotation regression");
  await service.ensureValidAccessToken(connection.id); if (calls !== 1) throw new Error("valid token refreshed unexpectedly");
  await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { credentialEnvelope: credentials.encryptCredential({ accessToken: newAccess, refreshToken: newRefresh, tokenExpiresAt: expired, refreshTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), providerMetadata: { shopId } }) } });
  await service.ensureValidAccessToken(connection.id).then(() => { throw new Error("expired refresh accepted"); }, () => undefined);
  const reauth = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connection.id } }); if (reauth.status !== MarketplaceConnectionStatus.REAUTH_REQUIRED || calls !== 1) throw new Error("reauthorization transition regression");
  await prisma.marketplaceConnection.delete({ where: { id: connection.id } }); await service.onModuleDestroy(); console.log("Shopee token refresh offline integration test passed");
}
void run().catch((error) => { console.error(error instanceof Error ? error.message : "Shopee token refresh test failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
