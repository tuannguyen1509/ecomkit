import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";

const previousKey = process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;
process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const marker = "TEST_EXTERNAL_ACCESS_TOKEN_SECRET";
const shopId = `external-${Date.now()}`;
const previousConfig = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE } });

try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(user, "test user required");
  const crypto = new MarketplaceCredentialService();
  const service = new MarketplaceProviderConfigService(crypto);
  await prisma.marketplaceProviderConfig.upsert({
    where: { platform: Platform.SHOPEE },
    create: { platform: Platform.SHOPEE, environment: "sandbox", partnerId: "TEST_PARTNER", partnerSecretEnvelope: crypto.encryptCredential({ providerMetadata: { partnerSecret: "TEST_PARTNER_SECRET" } }), redirectUri: "http://localhost/callback", isEnabled: true },
    update: { environment: "sandbox", partnerId: "TEST_PARTNER", partnerSecretEnvelope: crypto.encryptCredential({ providerMetadata: { partnerSecret: "TEST_PARTNER_SECRET" } }), redirectUri: "http://localhost/callback", isEnabled: true },
  });
  const safe = await service.importExternalToken(user.id, { shopId, accessToken: marker, accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(safe.credentialSource, "EXTERNAL_IMPORT"); assert.equal(safe.refreshOwnership, "EXTERNAL"); assert.equal(JSON.stringify(safe).includes(marker), false);
  const row = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: shopId } } });
  assert.equal(row.status, MarketplaceConnectionStatus.ACTIVE); assert.ok(row.credentialEnvelope); assert.equal(row.credentialEnvelope.includes(marker), false);
  const credential = crypto.decryptCredential(row.credentialEnvelope);
  assert.equal(credential.accessToken, marker); assert.equal(credential.refreshToken, undefined); assert.equal(credential.providerMetadata?.credentialSource, "EXTERNAL_IMPORT"); assert.equal(credential.providerMetadata?.refreshOwnership, "EXTERNAL");
  const overview = await service.overview(); assert.equal(JSON.stringify(overview).includes(marker), false);
  await assert.rejects(() => service.importExternalToken(user.id, { shopId, accessToken: marker, accessTokenExpiresAt: new Date(Date.now() - 1).toISOString() }), (error: unknown) => JSON.stringify(error).includes("EXTERNAL_ACCESS_TOKEN_EXPIRED"));
  console.log("Shopee external token import tests passed");
} finally {
  await prisma.marketplaceConnection.deleteMany({ where: { platform: Platform.SHOPEE, externalShopId: shopId } });
  if (previousConfig) await prisma.marketplaceProviderConfig.upsert({ where: { platform: Platform.SHOPEE }, create: previousConfig, update: previousConfig });
  else await prisma.marketplaceProviderConfig.deleteMany({ where: { platform: Platform.SHOPEE } });
  if (previousKey === undefined) delete process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY; else process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = previousKey;
  await prisma.$disconnect();
}
