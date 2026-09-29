import { loadShopeeRuntimeConfig, type ShopeeEnvironment, type ShopeeRuntimeConfig } from "@ecomkit/shared";

export type StoredShopeeAppConfig = Readonly<{ environment: string; partnerId: string; partnerSecretEnvelope: string; redirectUri: string; isEnabled: boolean }>;
export type ShopeeAppConfig = ShopeeRuntimeConfig & Readonly<{ redirectUri?: string; source: "database" | "environment" }>;
export interface ShopeeAppConfigRepository { findShopee(): Promise<StoredShopeeAppConfig | null>; }
export interface MarketplaceProviderSecretCrypto { decryptPartnerSecret(envelope: string): string; }

export class ShopeeAppConfigError extends Error {
  constructor(public readonly code: "SHOPEE_CONFIG_INVALID" | "SHOPEE_CONFIG_DECRYPT_FAILED" | "SHOPEE_REDIRECT_URI_INVALID") { super(code); this.name = "ShopeeAppConfigError"; }
}

function redirect(value: string): string {
  try { const url = new URL(value); if (!url.hostname) throw new Error(); return url.toString(); }
  catch { throw new ShopeeAppConfigError("SHOPEE_REDIRECT_URI_INVALID"); }
}

export class ShopeeAppConfigResolver {
  constructor(private readonly repository: ShopeeAppConfigRepository, private readonly crypto: MarketplaceProviderSecretCrypto, private readonly env: Record<string, string | undefined> = process.env) {}
  async resolve(options: Readonly<{ requireRedirect?: boolean }> = {}): Promise<ShopeeAppConfig> {
    const stored = await this.repository.findShopee();
    if (stored?.isEnabled) {
      if (stored.environment !== "sandbox" && stored.environment !== "production" || !stored.partnerId.trim()) throw new ShopeeAppConfigError("SHOPEE_CONFIG_INVALID");
      let partnerKey: string; try { partnerKey = this.crypto.decryptPartnerSecret(stored.partnerSecretEnvelope); } catch { throw new ShopeeAppConfigError("SHOPEE_CONFIG_DECRYPT_FAILED"); }
      if (!partnerKey) throw new ShopeeAppConfigError("SHOPEE_CONFIG_DECRYPT_FAILED");
      return { environment: stored.environment as ShopeeEnvironment, partnerId: stored.partnerId, partnerKey, timeoutMs: Number(this.env.SHOPEE_HTTP_TIMEOUT_MS ?? "30000"), redirectUri: redirect(stored.redirectUri), source: "database" };
    }
    const runtime = loadShopeeRuntimeConfig(this.env); const redirectUri = this.env.SHOPEE_REDIRECT_URI?.trim();
    if (options.requireRedirect && !redirectUri) throw new ShopeeAppConfigError("SHOPEE_REDIRECT_URI_INVALID");
    return { ...runtime, ...(redirectUri ? { redirectUri: redirect(redirectUri) } : {}), source: "environment" };
  }
}
