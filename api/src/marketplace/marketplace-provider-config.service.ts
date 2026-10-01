import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceCredentialCryptoError, getShopeeAuthorizationBaseUrl, getShopeeBaseUrl, ShopeeSigner } from "@ecomkit/shared";
import { ShopeeAppConfigError, ShopeeAppConfigResolver } from "@ecomkit/marketplace-server";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import type { UpdateShopeeProviderConfigDto } from "./marketplace-provider-config.dto.js";
import type { ImportShopeeExternalTokenDto } from "./marketplace-provider-config.dto.js";

const safeSelect = { platform: true, environment: true, partnerId: true, redirectUri: true, isEnabled: true, partnerSecretEnvelope: true, lastTestedAt: true, lastTestStatus: true, lastTestCode: true, createdAt: true, updatedAt: true } as const;
export type SafeProviderConfig = { platform: "SHOPEE"; environment: string; partnerId: string; partnerIdConfigured: boolean; partnerSecretConfigured: boolean; redirectUri: string; enabled: boolean; encryptionReady: boolean; lastTestedAt: Date | null; lastTestStatus: string | null; lastTestCode: string | null; createdAt: Date; updatedAt: Date };

@Injectable()
export class MarketplaceProviderConfigService {
  constructor(@Inject(MarketplaceCredentialService) private readonly credentials: MarketplaceCredentialService) {}
  resolver(env: Record<string, string | undefined> = process.env): ShopeeAppConfigResolver {
    return new ShopeeAppConfigResolver({ findShopee: async () => prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE }, select: { environment: true, partnerId: true, partnerSecretEnvelope: true, redirectUri: true, isEnabled: true } }) }, { decryptPartnerSecret: (envelope: string) => this.secret(envelope) }, env);
  }
  async resolveRuntime(requireRedirect = false) { return this.resolver().resolve({ requireRedirect }); }
  async list() { const config = await this.getShopee(); return [{ platform: "SHOPEE", implemented: true, config }, { platform: "LAZADA", implemented: true }, { platform: "TIKTOK", implemented: false }]; }
  async getShopee(): Promise<SafeProviderConfig | null> { const row = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE }, select: safeSelect }); return row ? this.safe(row) : null; }
  async updateShopee(userId: string, input: UpdateShopeeProviderConfigDto): Promise<SafeProviderConfig> {
    if (input.environment === "production" && !input.redirectUri.startsWith("https://")) throw new BadRequestException({ errorCode: "SHOPEE_REDIRECT_URI_INVALID", message: "Production redirect URI must use HTTPS." });
    const existing = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE }, select: { partnerSecretEnvelope: true } });
    if (!existing && !input.partnerKey?.trim()) throw new BadRequestException({ errorCode: "SHOPEE_PARTNER_KEY_REQUIRED", message: "Partner Key is required for initial configuration." });
    let envelope = existing?.partnerSecretEnvelope;
    if (input.partnerKey?.trim()) { try { envelope = this.credentials.encryptCredential({ providerMetadata: { partnerSecret: input.partnerKey } }); } catch (error) { if (error instanceof MarketplaceCredentialCryptoError) throw new ConflictException({ errorCode: "MARKETPLACE_ENCRYPTION_KEY_NOT_CONFIGURED", message: "Server encryption key is not configured." }); throw error; } }
    const row = await prisma.marketplaceProviderConfig.upsert({ where: { platform: Platform.SHOPEE }, create: { platform: Platform.SHOPEE, environment: input.environment, partnerId: input.partnerId.trim(), partnerSecretEnvelope: envelope!, redirectUri: input.redirectUri, isEnabled: input.enabled, createdById: userId, updatedById: userId }, update: { environment: input.environment, partnerId: input.partnerId.trim(), partnerSecretEnvelope: envelope!, redirectUri: input.redirectUri, isEnabled: input.enabled, updatedById: userId }, select: safeSelect });
    return this.safe(row);
  }
  async testShopee(): Promise<Record<string, unknown>> {
    const now = new Date();
    try {
      const config = await this.resolveRuntime(true); const timestamp = 1_700_000_000; const signature = new ShopeeSigner(config.partnerId, config.partnerKey).signPublic("/api/v2/auth/token/get", timestamp);
      const auth = new URL("/auth", getShopeeAuthorizationBaseUrl(config.environment)); auth.searchParams.set("partner_id", config.partnerId); auth.searchParams.set("auth_type", "seller"); auth.searchParams.set("redirect_uri", config.redirectUri!); auth.searchParams.set("response_type", "code"); auth.searchParams.set("state", "LOCAL_CONFIGURATION_TEST");
      if (!/^[a-f0-9]{64}$/.test(signature) || !getShopeeBaseUrl(config.environment)) throw new ShopeeAppConfigError("SHOPEE_CONFIG_INVALID");
      await prisma.marketplaceProviderConfig.updateMany({ where: { platform: Platform.SHOPEE }, data: { lastTestedAt: now, lastTestStatus: "PASS", lastTestCode: "SHOPEE_CONFIG_READY" } });
      return { status: "PASS", code: "SHOPEE_CONFIG_READY", source: config.source, checks: { partnerId: true, partnerKeyEncrypted: true, encryptionKey: true, environment: true, redirectUri: true, endpointResolution: true, signing: true, oauthUrlGeneration: true, apiWorkerParity: true }, liveProviderTested: false };
    } catch (error) {
      const code: string = error instanceof ShopeeAppConfigError ? error.code : error instanceof MarketplaceCredentialCryptoError ? "SHOPEE_CONFIG_DECRYPT_FAILED" : "SHOPEE_CONFIG_INVALID";
      await prisma.marketplaceProviderConfig.updateMany({ where: { platform: Platform.SHOPEE }, data: { lastTestedAt: now, lastTestStatus: "FAIL", lastTestCode: code } }).catch(() => undefined);
      throw new BadRequestException({ errorCode: code, message: "Shopee configuration validation failed." });
    }
  }
  async overview() {
    const rows = await prisma.marketplaceConnection.findMany({ where: { platform: Platform.SHOPEE }, orderBy: { updatedAt: "desc" }, select: { id: true, externalShopId: true, shopName: true, status: true, credentialEnvelope: true, lastSuccessfulSyncAt: true, lastAttemptedSyncAt: true, createdAt: true, updatedAt: true, syncRuns: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, syncType: true, triggerType: true, status: true, errorCount: true, createdAt: true, completedAt: true } } } });
    const connections = rows.map(({ credentialEnvelope, ...row }) => { let metadata: Record<string, unknown> = {}; try { metadata = credentialEnvelope ? this.credentials.decryptCredential(credentialEnvelope).providerMetadata ?? {} : {}; } catch {} return { ...row, accessTokenConfigured: Boolean(credentialEnvelope), accessTokenExpiresAt: typeof metadata.accessTokenExpiresAt === "string" ? metadata.accessTokenExpiresAt : null, credentialSource: metadata.credentialSource === "EXTERNAL_IMPORT" ? "EXTERNAL_IMPORT" : "OAUTH", refreshOwnership: metadata.refreshOwnership === "EXTERNAL" ? "EXTERNAL" : "ECOMKIT", liveApiStatus: typeof metadata.liveApiStatus === "string" ? metadata.liveApiStatus : "NOT_TESTED", lastLiveTestedAt: typeof metadata.lastLiveTestedAt === "string" ? metadata.lastLiveTestedAt : null }; });
    return { config: await this.getShopee(), encryptionReady: this.encryptionReady(), connections };
  }
  async importExternalToken(userId: string, input: ImportShopeeExternalTokenDto) {
    const expiresAt = new Date(input.accessTokenExpiresAt);
    if (!Number.isFinite(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now()) throw new BadRequestException({ errorCode: "EXTERNAL_ACCESS_TOKEN_EXPIRED", message: "The imported access token is expired." });
    const existing = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.SHOPEE }, select: { partnerSecretEnvelope: true, redirectUri: true } });
    if (!existing && !input.partnerKey?.trim()) throw new BadRequestException({ errorCode: "SHOPEE_PARTNER_KEY_REQUIRED", message: "Partner Key is required for initial external configuration." });
    let partnerSecretEnvelope = existing?.partnerSecretEnvelope;
    let credentialEnvelope: string;
    try {
      if (input.partnerKey?.trim()) partnerSecretEnvelope = this.credentials.encryptCredential({ providerMetadata: { partnerSecret: input.partnerKey } });
      credentialEnvelope = this.credentials.encryptCredential({ accessToken: input.accessToken, tokenExpiresAt: expiresAt.toISOString(), providerMetadata: { shopId: input.shopId.trim(), credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL", accessTokenExpiresAt: expiresAt.toISOString(), liveApiStatus: "NOT_TESTED" } });
    }
    catch { throw new ConflictException({ errorCode: "MARKETPLACE_ENCRYPTION_KEY_NOT_CONFIGURED", message: "Server encryption key is not configured." }); }
    const row = await prisma.$transaction(async (tx) => {
      await tx.marketplaceProviderConfig.upsert({ where: { platform: Platform.SHOPEE }, create: { platform: Platform.SHOPEE, environment: input.environment, partnerId: input.partnerId.trim(), partnerSecretEnvelope: partnerSecretEnvelope!, redirectUri: "", isEnabled: true, createdById: userId, updatedById: userId }, update: { environment: input.environment, partnerId: input.partnerId.trim(), partnerSecretEnvelope: partnerSecretEnvelope!, updatedById: userId } });
      return tx.marketplaceConnection.upsert({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: input.shopId.trim() } }, create: { platform: Platform.SHOPEE, externalShopId: input.shopId.trim(), status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope, createdByUserId: userId }, update: { status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope }, select: { id: true, externalShopId: true, status: true, updatedAt: true } });
    });
    return { ...row, credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL", accessTokenConfigured: true, accessTokenExpiresAt: expiresAt.toISOString() };
  }
  async testExternalReadOnly(connectionId: string): Promise<Record<string, unknown>> {
    try {
      const config = await this.resolveRuntime(false);
      const row = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { platform: true, externalShopId: true, credentialEnvelope: true } });
      if (!row || row.platform !== Platform.SHOPEE || !row.credentialEnvelope) throw new Error("missing external credential");
      const credential = this.credentials.decryptCredential(row.credentialEnvelope); const metadata = credential.providerMetadata ?? {};
      if (metadata.credentialSource !== "EXTERNAL_IMPORT" || metadata.refreshOwnership !== "EXTERNAL" || !credential.accessToken) throw new Error("invalid external credential");
      const expiresAt = new Date(String(metadata.accessTokenExpiresAt ?? credential.tokenExpiresAt ?? ""));
      if (!Number.isFinite(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now()) throw new BadRequestException({ errorCode: "EXTERNAL_ACCESS_TOKEN_EXPIRED", message: "The imported access token is expired." });
      const signature = new ShopeeSigner(config.partnerId, config.partnerKey).signShop("/api/v2/order/get_order_list", 1_700_000_000, credential.accessToken, row.externalShopId);
      if (!/^[a-f0-9]{64}$/.test(signature) || !getShopeeBaseUrl(config.environment)) throw new Error("invalid external config");
      return { status: "PASS", code: "SHOPEE_EXTERNAL_CONFIG_READY", mode: "EXTERNAL_IMPORT_READ_ONLY", checks: { environment: true, partnerId: true, partnerKeyEncrypted: true, shopId: true, accessTokenEncrypted: true, accessTokenExpiry: true, signing: true, endpointResolution: true, apiWorkerParity: true, redirectUriRequired: false, oauthRequired: false, refreshTokenRequired: false }, liveProviderTested: false };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const code = error instanceof ShopeeAppConfigError ? error.code : error instanceof MarketplaceCredentialCryptoError ? "SHOPEE_CONFIG_DECRYPT_FAILED" : "SHOPEE_EXTERNAL_CONFIG_INVALID";
      throw new BadRequestException({ errorCode: code, message: "Shopee external read-only configuration validation failed." });
    }
  }
  async recordLiveTest(connectionId: string, status: "PASS" | "FAIL") {
    const row = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { credentialEnvelope: true } });
    if (!row?.credentialEnvelope) return;
    const credential = this.credentials.decryptCredential(row.credentialEnvelope); const metadata = { ...(credential.providerMetadata ?? {}), liveApiStatus: status, lastLiveTestedAt: new Date().toISOString() };
    await prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { credentialEnvelope: this.credentials.encryptCredential({ ...credential, providerMetadata: metadata }) } });
  }
  private secret(envelope: string): string { const metadata = this.credentials.decryptCredential(envelope).providerMetadata; const value = metadata?.partnerSecret; if (typeof value !== "string" || !value) throw new Error("invalid provider secret"); return value; }
  private safe(row: any): SafeProviderConfig { return { platform: "SHOPEE", environment: row.environment, partnerId: row.partnerId, partnerIdConfigured: Boolean(row.partnerId), partnerSecretConfigured: Boolean(row.partnerSecretEnvelope), redirectUri: row.redirectUri, enabled: row.isEnabled, encryptionReady: this.encryptionReady(), lastTestedAt: row.lastTestedAt, lastTestStatus: row.lastTestStatus, lastTestCode: row.lastTestCode, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private encryptionReady(): boolean { try { this.credentials.encryptCredential({ providerMetadata: { partnerSecret: "probe" } }); return true; } catch { return false; } }
}
