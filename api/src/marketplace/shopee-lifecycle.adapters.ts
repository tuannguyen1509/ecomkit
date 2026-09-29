import { randomUUID } from "node:crypto";
import { MarketplaceConnectionStatus, prisma } from "@ecomkit/database";
import {
  type Clock,
  type DistributedLockProvider,
  type MarketplaceCredentialCrypto,
  MarketplaceLifecycleError,
  type MarketplaceLifecycleConnectionRepository,
  type ShopeeCredential,
  type ShopeeTokenRefreshClient,
} from "@ecomkit/marketplace-server";
import { loadShopeeRuntimeConfig, ShopeeHttpClient, ShopeeHttpError } from "@ecomkit/shared";
import type { ShopeeResponse } from "@ecomkit/shared";
import { Redis } from "ioredis";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";

type RefreshResponse = { access_token?: string; refresh_token?: string; expire_in?: number };
export type ApiShopeeRefreshClient = { requestPublic(request: { operation: string; apiPath: string; method: "POST"; body: unknown }): Promise<ShopeeResponse<RefreshResponse>> };

export class PrismaMarketplaceLifecycleConnectionRepository implements MarketplaceLifecycleConnectionRepository {
  async getById(connectionId: string) {
    const row = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { id: true, platform: true, externalShopId: true, status: true, credentialEnvelope: true } });
    return row ? { connectionId: row.id, platform: row.platform, externalShopId: row.externalShopId, status: row.status, credentialEnvelope: row.credentialEnvelope } : null;
  }
  async replaceCredentialEnvelope(input: Readonly<{ connectionId: string; credentialEnvelope: string }>): Promise<void> {
    await prisma.marketplaceConnection.update({ where: { id: input.connectionId }, data: { credentialEnvelope: input.credentialEnvelope, status: MarketplaceConnectionStatus.ACTIVE } });
  }
  async markReauthRequired(connectionId: string): Promise<void> { await prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { status: MarketplaceConnectionStatus.REAUTH_REQUIRED } }); }
}

export class ApiMarketplaceCredentialCrypto implements MarketplaceCredentialCrypto {
  constructor(private readonly credentials: MarketplaceCredentialService) {}
  encrypt(credential: ShopeeCredential): string { return this.credentials.encryptCredential(credential); }
  decrypt(envelope: string): ShopeeCredential { return this.credentials.decryptCredential(envelope); }
}

export class RedisDistributedLockProvider implements DistributedLockProvider {
  private client?: Redis;
  private redis(): Redis { return this.client ??= new Redis({ host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379"), maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true }); }
  async acquire(key: string, ttlMs: number) {
    try {
      const redis = this.redis(); if (redis.status === "wait") await redis.connect();
      const owner = randomUUID(), acquired = await redis.set(key, owner, "PX", ttlMs, "NX");
      if (acquired !== "OK") return { kind: "busy" } as const;
      return { kind: "acquired" as const, key, release: async () => { await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, key, owner); } };
    } catch { return { kind: "unavailable" } as const; }
  }
  async dispose(): Promise<void> { await this.client?.quit().catch(() => undefined); }
}

export class ApiShopeeTokenRefreshClient implements ShopeeTokenRefreshClient {
  constructor(private readonly clientFactory?: () => ApiShopeeRefreshClient, private readonly configFactory?: () => Promise<ReturnType<typeof loadShopeeRuntimeConfig>>) {}
  async refreshShopToken(input: Readonly<{ shopId: string; refreshToken: string }>) {
    try {
      const config = this.configFactory ? await this.configFactory() : loadShopeeRuntimeConfig(); const client = this.clientFactory?.() ?? new ShopeeHttpClient(config);
      const response = await client.requestPublic<RefreshResponse>({ operation: "SHOPEE_TOKEN_REFRESH", apiPath: "/api/v2/auth/access_token/get", method: "POST", body: { refresh_token: input.refreshToken, partner_id: Number(config.partnerId), shop_id: Number(input.shopId) } });
      if (response.error === "common.error_auth") throw new MarketplaceLifecycleError("SHOPEE_REAUTH_REQUIRED", false, response.request_id);
      if (response.error) throw new MarketplaceLifecycleError("SHOPEE_REFRESH_FAILED", false, response.request_id);
      return { accessToken: response.response?.access_token, refreshToken: response.response?.refresh_token, expireIn: response.response?.expire_in, requestId: response.request_id };
    } catch (error) {
      if (error instanceof MarketplaceLifecycleError) throw error;
      if (error instanceof ShopeeHttpError) throw new MarketplaceLifecycleError("SHOPEE_REFRESH_FAILED", error.safe.retryableHint, error.safe.requestId);
      throw new MarketplaceLifecycleError("SHOPEE_REFRESH_FAILED", true);
    }
  }
}

export const systemClock: Clock = { now: () => new Date() };
