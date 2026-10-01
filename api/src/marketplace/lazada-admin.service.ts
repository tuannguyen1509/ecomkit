import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { FetchLazadaTransport, LazadaHttpClientCore, LazadaHttpError, LazadaOrderClient, type LazadaTransport } from "@ecomkit/marketplace-server";
import { MarketplaceCredentialCryptoError } from "@ecomkit/shared";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import type { ImportLazadaExternalTokenDto, UpdateLazadaProviderConfigDto } from "./marketplace-provider-config.dto.js";

const safeSelect = { platform: true, environment: true, partnerId: true, redirectUri: true, isEnabled: true, partnerSecretEnvelope: true, lastTestedAt: true, lastTestStatus: true, lastTestCode: true, createdAt: true, updatedAt: true } as const;
type TransportFactory = () => LazadaTransport;

@Injectable()
export class LazadaAdminService {
  constructor(
    @Inject(MarketplaceCredentialService) private readonly credentials: MarketplaceCredentialService,
    @Optional() private readonly transportFactory?: TransportFactory,
  ) {}

  async overview() {
    const config = await this.getConfig();
    const rows = await prisma.marketplaceConnection.findMany({ where: { platform: Platform.LAZADA }, orderBy: { updatedAt: "desc" }, select: { id: true, externalShopId: true, status: true, credentialEnvelope: true, createdAt: true, updatedAt: true } });
    const connections = rows.map(({ credentialEnvelope, ...row }) => {
      let credential: ReturnType<MarketplaceCredentialService["decryptCredential"]> | undefined;
      try { credential = credentialEnvelope ? this.credentials.decryptCredential(credentialEnvelope) : undefined; } catch {}
      const metadata = credential?.providerMetadata ?? {};
      return { ...row, sellerId: typeof metadata.sellerId === "string" ? metadata.sellerId : row.externalShopId.replace(/^vn:/, ""), accessTokenConfigured: Boolean(credential?.accessToken), accessTokenExpiresAt: credential?.tokenExpiresAt ?? null, credentialSource: metadata.credentialSource === "EXTERNAL_IMPORT" ? "EXTERNAL_IMPORT" : "OAUTH", refreshOwnership: metadata.refreshOwnership === "EXTERNAL" ? "EXTERNAL" : "ECOMKIT", liveApiStatus: typeof metadata.liveApiStatus === "string" ? metadata.liveApiStatus : "NOT_TESTED", lastLiveTestedAt: typeof metadata.lastLiveTestedAt === "string" ? metadata.lastLiveTestedAt : null };
    });
    return { config, region: "Vietnam", apiEnvironment: "production", encryptionReady: this.encryptionReady(), connections };
  }

  async updateConfig(userId: string, input: UpdateLazadaProviderConfigDto) {
    const existing = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.LAZADA }, select: { partnerSecretEnvelope: true } });
    if (!existing && !input.appSecret?.trim()) throw new BadRequestException({ errorCode: "LAZADA_APP_SECRET_REQUIRED", message: "App Secret is required for initial configuration." });
    let envelope = existing?.partnerSecretEnvelope;
    if (input.appSecret?.trim()) {
      try { envelope = this.credentials.encryptCredential({ providerMetadata: { partnerSecret: input.appSecret } }); }
      catch { throw new ConflictException({ errorCode: "MARKETPLACE_ENCRYPTION_KEY_NOT_CONFIGURED", message: "Server encryption key is not configured." }); }
    }
    const row = await prisma.marketplaceProviderConfig.upsert({ where: { platform: Platform.LAZADA }, create: { platform: Platform.LAZADA, environment: "production", partnerId: input.appKey.trim(), partnerSecretEnvelope: envelope!, redirectUri: input.redirectUri?.trim() ?? "", isEnabled: input.enabled, createdById: userId, updatedById: userId }, update: { environment: "production", partnerId: input.appKey.trim(), partnerSecretEnvelope: envelope!, redirectUri: input.redirectUri?.trim() ?? "", isEnabled: input.enabled, updatedById: userId }, select: safeSelect });
    return this.safe(row);
  }

  async saveExternal(userId: string, input: ImportLazadaExternalTokenDto) {
    const sellerId = input.sellerId.trim();
    if (!sellerId || !/^[\p{L}\p{N}._:-]+$/u.test(sellerId)) throw new BadRequestException({ errorCode: "LAZADA_SELLER_ID_INVALID", message: "Seller ID is invalid." });
    const expiresAt = new Date(input.accessTokenExpiresAt);
    if (!Number.isFinite(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now()) throw new BadRequestException({ errorCode: "EXTERNAL_ACCESS_TOKEN_EXPIRED", message: "The imported access token is expired." });
    const externalShopId = `vn:${sellerId}`;
    const existing = await prisma.marketplaceConnection.findUnique({ where: { platform_externalShopId: { platform: Platform.LAZADA, externalShopId } }, select: { credentialEnvelope: true } });
    let previous: ReturnType<MarketplaceCredentialService["decryptCredential"]> | undefined;
    if (existing?.credentialEnvelope) try { previous = this.credentials.decryptCredential(existing.credentialEnvelope); } catch {}
    const accessToken = input.accessToken?.trim() || previous?.accessToken;
    if (!accessToken) throw new BadRequestException({ errorCode: "LAZADA_ACCESS_TOKEN_REQUIRED", message: "Access Token is required for initial external configuration." });
    let credentialEnvelope: string;
    try { credentialEnvelope = this.credentials.encryptCredential({ accessToken, tokenExpiresAt: expiresAt.toISOString(), providerMetadata: { sellerId, country: "vn", credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL", liveApiStatus: previous?.providerMetadata?.liveApiStatus ?? "NOT_TESTED", lastLiveTestedAt: previous?.providerMetadata?.lastLiveTestedAt } }); }
    catch { throw new ConflictException({ errorCode: "MARKETPLACE_ENCRYPTION_KEY_NOT_CONFIGURED", message: "Server encryption key is not configured." }); }
    const row = await prisma.marketplaceConnection.upsert({ where: { platform_externalShopId: { platform: Platform.LAZADA, externalShopId } }, create: { platform: Platform.LAZADA, externalShopId, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope, createdByUserId: userId }, update: { status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope }, select: { id: true, externalShopId: true, status: true, updatedAt: true } });
    return { ...row, sellerId, credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL", accessTokenConfigured: true, accessTokenExpiresAt: expiresAt.toISOString() };
  }

  async structuralTest(connectionId?: string) {
    const now = new Date();
    try {
      const config = await this.runtimeConfig();
      let externalChecks: Record<string, boolean> = {};
      if (connectionId) { await this.externalCredential(connectionId); externalChecks = { sellerId: true, accessTokenEncrypted: true, accessTokenExpiry: true }; }
      await prisma.marketplaceProviderConfig.updateMany({ where: { platform: Platform.LAZADA }, data: { lastTestedAt: now, lastTestStatus: "PASS", lastTestCode: "LAZADA_CONFIG_READY" } });
      return { status: "PASS", code: "LAZADA_CONFIG_READY", message: "CẤU HÌNH SẴN SÀNG — chưa kiểm tra live.", checks: { regionVietnam: true, appKey: true, appSecretEncrypted: true, encryptionKey: true, redirectUriRequired: false, oauthRequired: false, refreshTokenRequired: false, ...externalChecks }, liveProviderTested: false, appKey: Boolean(config.appKey) };
    } catch (error) { const code = this.errorCode(error, "LAZADA_CONFIG_INVALID"); await prisma.marketplaceProviderConfig.updateMany({ where: { platform: Platform.LAZADA }, data: { lastTestedAt: now, lastTestStatus: "FAIL", lastTestCode: code } }).catch(() => undefined); throw new BadRequestException({ errorCode: code, message: "Lazada configuration validation failed." }); }
  }

  async liveTest(connectionId: string) {
    const before = new Date();
    try {
      const config = await this.runtimeConfig(); const external = await this.externalCredential(connectionId);
      const client = new LazadaOrderClient(new LazadaHttpClientCore(config, this.transportFactory?.() ?? new FetchLazadaTransport()), { ensureValidAccessToken: async () => ({ accessToken: external.accessToken, externalShopId: external.externalShopId, accessTokenExpiresAt: external.expiresAt }) });
      const to = new Date(), from = new Date(to.valueOf() - 60 * 60 * 1000);
      const page = await client.listOrders({ connectionId, window: { mode: "CREATE_TIME", from: from.toISOString(), to: to.toISOString() }, limit: 1, offset: 0, sortDirection: "DESC" });
      await this.recordLiveTest(connectionId, "PASS");
      return { success: true, status: "PASS", mode: "EXTERNAL_IMPORT_READ_ONLY", requestId: page.requestId, orderCount: page.orders.length, testedAt: before.toISOString(), externalShopId: external.externalShopId, window: { from: from.toISOString(), to: to.toISOString() } };
    } catch (error) { await this.recordLiveTest(connectionId, "FAIL").catch(() => undefined); if (error instanceof BadRequestException) throw error; if (error instanceof LazadaHttpError) throw new BadRequestException({ errorCode: error.code, message: error.message, requestId: error.requestId, httpStatus: error.httpStatus, retryable: error.retryable }); throw new BadRequestException({ errorCode: this.errorCode(error, "LAZADA_LIVE_TEST_FAILED"), message: "Lazada live read-only test failed." }); }
  }

  private async getConfig() { const row = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.LAZADA }, select: safeSelect }); return row ? this.safe(row) : null; }
  private safe(row: any) { return { platform: "LAZADA", region: "VN", environment: "production", appKey: row.partnerId, appKeyConfigured: Boolean(row.partnerId), appSecretConfigured: Boolean(row.partnerSecretEnvelope), redirectUri: row.redirectUri, enabled: row.isEnabled, encryptionReady: this.encryptionReady(), lastTestedAt: row.lastTestedAt, lastTestStatus: row.lastTestStatus, lastTestCode: row.lastTestCode, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private async runtimeConfig() { const row = await prisma.marketplaceProviderConfig.findUnique({ where: { platform: Platform.LAZADA }, select: { partnerId: true, partnerSecretEnvelope: true, isEnabled: true, environment: true } }); if (!row?.isEnabled || row.environment !== "production") throw new Error("LAZADA_CONFIG_MISSING"); const secret = this.credentials.decryptCredential(row.partnerSecretEnvelope).providerMetadata?.partnerSecret; if (!row.partnerId || typeof secret !== "string" || !secret) throw new Error("LAZADA_CONFIG_MISSING"); return { appKey: row.partnerId, appSecret: secret, timeoutMs: Number(process.env.LAZADA_HTTP_TIMEOUT_MS ?? "30000") }; }
  private async externalCredential(connectionId: string) { const row = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { platform: true, externalShopId: true, credentialEnvelope: true } }); if (!row || row.platform !== Platform.LAZADA || !row.credentialEnvelope) throw new Error("LAZADA_EXTERNAL_CONFIG_MISSING"); const credential = this.credentials.decryptCredential(row.credentialEnvelope), metadata = credential.providerMetadata ?? {}; if (metadata.credentialSource !== "EXTERNAL_IMPORT" || metadata.refreshOwnership !== "EXTERNAL" || !credential.accessToken) throw new Error("LAZADA_EXTERNAL_CONFIG_INVALID"); const expires = new Date(credential.tokenExpiresAt ?? ""); if (!Number.isFinite(expires.valueOf()) || expires <= new Date()) throw new BadRequestException({ errorCode: "EXTERNAL_ACCESS_TOKEN_EXPIRED", message: "The imported access token is expired." }); return { accessToken: credential.accessToken, expiresAt: expires.toISOString(), externalShopId: row.externalShopId }; }
  private async recordLiveTest(connectionId: string, status: "PASS" | "FAIL") { const row = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { credentialEnvelope: true } }); if (!row?.credentialEnvelope) return; const credential = this.credentials.decryptCredential(row.credentialEnvelope); await prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { credentialEnvelope: this.credentials.encryptCredential({ ...credential, providerMetadata: { ...(credential.providerMetadata ?? {}), liveApiStatus: status, lastLiveTestedAt: new Date().toISOString() } }) } }); }
  private encryptionReady() { try { this.credentials.encryptCredential({ providerMetadata: { partnerSecret: "probe" } }); return true; } catch { return false; } }
  private errorCode(error: unknown, fallback: string) { if (error instanceof BadRequestException) return String((error.getResponse() as { errorCode?: string }).errorCode ?? fallback); if (error instanceof MarketplaceCredentialCryptoError) return "LAZADA_CONFIG_DECRYPT_FAILED"; return error instanceof Error && /^LAZADA_|^EXTERNAL_/.test(error.message) ? error.message : fallback; }
}
