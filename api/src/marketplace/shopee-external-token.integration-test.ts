import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ImportShopeeExternalTokenDto } from "./marketplace-provider-config.dto.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";

const previousKey = process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;
process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const marker = "TEST_EXTERNAL_ACCESS_TOKEN_SECRET";
const partnerMarker = "TEST_EXTERNAL_PARTNER_KEY_SECRET";
const shopId = `external-${Date.now()}`;
const previousConfig = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE } });

try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(user, "test user required");
  const crypto = new MarketplaceCredentialService();
  const service = new MarketplaceProviderConfigService(crypto);
  const validInput = { environment: "production", partnerId: "TEST_PARTNER", partnerKey: partnerMarker, shopId, accessToken: marker, accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } as const;
  for (const field of ["partnerId", "partnerKey", "shopId", "accessToken", "accessTokenExpiresAt"] as const) {
    const invalid = { ...validInput, [field]: "" }; assert.ok((await validate(plainToInstance(ImportShopeeExternalTokenDto, invalid))).length > 0, `${field} must be validated`);
  }
  await prisma.marketplaceProviderConfig.deleteMany({ where: { platform: Platform.SHOPEE } });
  const safe = await service.importExternalToken(user.id, validInput);
  assert.equal(safe.credentialSource, "EXTERNAL_IMPORT"); assert.equal(safe.refreshOwnership, "EXTERNAL"); assert.equal(JSON.stringify(safe).includes(marker), false);
  const provider = await prisma.marketplaceProviderConfig.findUniqueOrThrow({ where: { platform: Platform.SHOPEE } });
  assert.equal(provider.redirectUri, ""); assert.equal(provider.environment, "production"); assert.equal(provider.partnerSecretEnvelope.includes(partnerMarker), false);
  assert.equal((await service.resolveRuntime(false)).partnerKey, partnerMarker);
  await assert.rejects(() => service.resolveRuntime(true), (error: unknown) => JSON.stringify(error).includes("SHOPEE_REDIRECT_URI_INVALID"));
  const row = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: shopId } } });
  assert.equal(row.status, MarketplaceConnectionStatus.ACTIVE); assert.ok(row.credentialEnvelope); assert.equal(row.credentialEnvelope.includes(marker), false);
  const credential = crypto.decryptCredential(row.credentialEnvelope);
  assert.equal(credential.accessToken, marker); assert.equal(credential.refreshToken, undefined); assert.equal(credential.providerMetadata?.credentialSource, "EXTERNAL_IMPORT"); assert.equal(credential.providerMetadata?.refreshOwnership, "EXTERNAL");
  const overview = await service.overview(); assert.equal(JSON.stringify(overview).includes(marker), false);
  const localTest = await service.testExternalReadOnly(row.id); assert.equal(localTest.status, "PASS"); assert.equal(localTest.liveProviderTested, false); assert.equal(JSON.stringify(localTest).includes(marker), false);
  await assert.rejects(() => service.importExternalToken(user.id, { environment: "production", partnerId: "TEST_PARTNER", shopId, accessToken: marker, accessTokenExpiresAt: new Date(Date.now() - 1).toISOString() }), (error: unknown) => JSON.stringify(error).includes("EXTERNAL_ACCESS_TOKEN_EXPIRED"));
  console.log("Shopee external token import tests passed");
} finally {
  await prisma.marketplaceConnection.deleteMany({ where: { platform: Platform.SHOPEE, externalShopId: shopId } });
  if (previousConfig) await prisma.marketplaceProviderConfig.upsert({ where: { platform: Platform.SHOPEE }, create: previousConfig, update: previousConfig });
  else await prisma.marketplaceProviderConfig.deleteMany({ where: { platform: Platform.SHOPEE } });
  if (previousKey === undefined) delete process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY; else process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = previousKey;
  await prisma.$disconnect();
}
