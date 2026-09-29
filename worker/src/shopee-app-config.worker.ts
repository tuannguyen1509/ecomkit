import { Platform, prisma } from "@ecomkit/database";
import { ShopeeAppConfigResolver } from "@ecomkit/marketplace-server";
import { decryptMarketplaceCredential } from "@ecomkit/shared";

export function createWorkerShopeeAppConfigResolver(env: Record<string, string | undefined> = process.env): ShopeeAppConfigResolver {
  return new ShopeeAppConfigResolver({ findShopee: async () => prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE }, select: { environment: true, partnerId: true, partnerSecretEnvelope: true, redirectUri: true, isEnabled: true } }) }, { decryptPartnerSecret: (envelope: string) => { const value = decryptMarketplaceCredential(envelope, env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY).providerMetadata?.partnerSecret; if (typeof value !== "string" || !value) throw new Error("invalid provider secret"); return value; } }, env);
}
