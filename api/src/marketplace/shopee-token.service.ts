import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceCredentialCryptoError, loadShopeeRuntimeConfig, ShopeeHttpClient, ShopeeHttpError } from "@ecomkit/shared";
import type { MarketplaceShopCredential, ShopeeResponse } from "@ecomkit/shared";
import { Redis } from "ioredis";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";

type RefreshResponse = { access_token?: string; refresh_token?: string; expire_in?: number };
type RefreshClient = { requestPublic(request: { operation: string; apiPath: string; method: "POST"; body: unknown }): Promise<ShopeeResponse<RefreshResponse>> };
export type ValidShopeeCredential = { accessToken: string; shopId: string; accessTokenExpiresAt: string };
const reauth = (): ConflictException => new ConflictException({ errorCode: "SHOPEE_REAUTH_REQUIRED", message: "Shopee connection must be reauthorized by an administrator." });

@Injectable()
export class ShopeeTokenService implements OnModuleDestroy {
  private client?: Redis;
  constructor(private readonly credentials: MarketplaceCredentialService, private readonly clientFactory: () => RefreshClient = () => new ShopeeHttpClient(loadShopeeRuntimeConfig())) {}
  private redis(): Redis { return this.client ??= new Redis({ host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379"), maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true }); }
  private skewMs(): number { return Number(process.env.SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS ?? "300") * 1000; }
  private async locked(connectionId: string): Promise<() => Promise<void>> {
    const redis = this.redis(); if (redis.status === "wait") await redis.connect(); const key = `shopee-refresh-lock-${connectionId}`, owner = randomUUID(), ttl = Number(process.env.SHOPEE_REFRESH_LOCK_TTL_MS ?? "30000");
    const acquired = await redis.set(key, owner, "PX", ttl, "NX"); if (acquired !== "OK") throw new ConflictException({ errorCode: "SHOPEE_REFRESH_IN_PROGRESS", message: "Shopee credential refresh is already in progress." });
    return async () => { await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, key, owner).catch(() => undefined); };
  }
  private valid(credential: MarketplaceShopCredential): credential is MarketplaceShopCredential & { accessToken: string; refreshToken: string; tokenExpiresAt: string; refreshTokenExpiresAt: string } {
    return Boolean(credential.accessToken && credential.refreshToken && credential.tokenExpiresAt && credential.refreshTokenExpiresAt && new Date(credential.tokenExpiresAt).valueOf() - Date.now() > this.skewMs());
  }
  private async waitForRefreshedCredential(connectionId: string): Promise<ValidShopeeCredential | null> {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const connection = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
      if (!connection?.credentialEnvelope) return null;
      try { const credential = this.credentials.decryptCredential(connection.credentialEnvelope); if (this.valid(credential)) return { accessToken: credential.accessToken, shopId: connection.externalShopId, accessTokenExpiresAt: credential.tokenExpiresAt }; } catch { return null; }
    }
    return null;
  }
  async ensureValidAccessToken(connectionId: string): Promise<ValidShopeeCredential> {
    const initial = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!initial) throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_NOT_FOUND", message: "Marketplace connection was not found." });
    if (initial.platform !== Platform.SHOPEE || initial.status !== MarketplaceConnectionStatus.ACTIVE) throw initial.status === MarketplaceConnectionStatus.REAUTH_REQUIRED ? reauth() : new ConflictException({ errorCode: "SHOPEE_CONNECTION_NOT_ACTIVE", message: "Shopee connection is not active." });
    let credential: MarketplaceShopCredential; try { credential = this.credentials.decryptCredential(initial.credentialEnvelope ?? ""); } catch (error) { if (error instanceof MarketplaceCredentialCryptoError) await prisma.marketplaceConnection.update({ where: { id: initial.id }, data: { status: MarketplaceConnectionStatus.REAUTH_REQUIRED } }); throw reauth(); }
    if (credential.providerMetadata?.shopId !== initial.externalShopId) throw new ConflictException({ errorCode: "SHOPEE_CREDENTIAL_SHOP_MISMATCH", message: "Shopee connection credential is invalid." });
    if (this.valid(credential)) return { accessToken: credential.accessToken, shopId: initial.externalShopId, accessTokenExpiresAt: credential.tokenExpiresAt };
    const refreshExpiry = credential.refreshTokenExpiresAt ? new Date(credential.refreshTokenExpiresAt).valueOf() : NaN;
    if (!credential.refreshToken || !Number.isFinite(refreshExpiry) || refreshExpiry <= Date.now()) { await prisma.marketplaceConnection.update({ where: { id: initial.id }, data: { status: MarketplaceConnectionStatus.REAUTH_REQUIRED } }); throw reauth(); }
    let release: () => Promise<void>; try { release = await this.locked(connectionId); } catch (error) { if (error instanceof ConflictException) { const refreshed = await this.waitForRefreshedCredential(connectionId); if (refreshed) return refreshed; throw error; } throw new ServiceUnavailableException({ errorCode: "SHOPEE_REFRESH_LOCK_UNAVAILABLE", message: "Shopee credential refresh cannot run now." }); }
    try {
      const current = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connectionId } });
      const fresh = this.credentials.decryptCredential(current.credentialEnvelope ?? "");
      if (this.valid(fresh)) return { accessToken: fresh.accessToken, shopId: current.externalShopId, accessTokenExpiresAt: fresh.tokenExpiresAt };
      if (!fresh.refreshToken || fresh.providerMetadata?.shopId !== current.externalShopId) throw reauth();
      let response: ShopeeResponse<RefreshResponse>; try { response = await this.clientFactory().requestPublic({ operation: "SHOPEE_TOKEN_REFRESH", apiPath: "/api/v2/auth/access_token/get", method: "POST", body: { refresh_token: fresh.refreshToken, partner_id: Number(loadShopeeRuntimeConfig().partnerId), shop_id: Number(current.externalShopId) } }); } catch (error) { if (error instanceof ShopeeHttpError && error.safe.retryableHint) throw new ServiceUnavailableException({ errorCode: "SHOPEE_REFRESH_TRANSIENT_FAILURE", message: "Shopee credential refresh failed temporarily." }); throw new ConflictException({ errorCode: "SHOPEE_REFRESH_FAILED", message: "Shopee credential refresh failed." }); }
      const token = response.response;
      if (response.error === "common.error_auth") { await prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { status: MarketplaceConnectionStatus.REAUTH_REQUIRED } }); throw reauth(); }
      if (response.error || !token?.access_token || !token.refresh_token || typeof token.expire_in !== "number" || token.expire_in <= 0) throw new ConflictException({ errorCode: "SHOPEE_REFRESH_RESPONSE_INVALID", message: "Shopee credential refresh failed." });
      const now = Date.now(), envelope = this.credentials.encryptCredential({ accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: new Date(now + token.expire_in * 1000).toISOString(), refreshTokenExpiresAt: new Date(now + 30 * 86400000).toISOString(), providerMetadata: { shopId: current.externalShopId } });
      await prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { credentialEnvelope: envelope, status: MarketplaceConnectionStatus.ACTIVE } });
      return { accessToken: token.access_token, shopId: current.externalShopId, accessTokenExpiresAt: new Date(now + token.expire_in * 1000).toISOString() };
    } finally { await release(); }
  }
  async onModuleDestroy(): Promise<void> { await this.client?.quit().catch(() => undefined); }
}
