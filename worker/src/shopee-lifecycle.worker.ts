import { randomUUID } from "node:crypto";
import { MarketplaceConnectionStatus, prisma } from "@ecomkit/database";
import {
  type Clock,
  type DistributedLockProvider,
  type MarketplaceCredentialCrypto,
  MarketplaceLifecycleError,
  type MarketplaceLifecycleConnectionRepository,
  type ShopeeCredential,
  ShopeeCredentialLifecycle,
  type ShopeeTokenRefreshClient,
} from "@ecomkit/marketplace-server";
import { decryptMarketplaceCredential, encryptMarketplaceCredential, loadShopeeRuntimeConfig, ShopeeHttpClient, ShopeeHttpError } from "@ecomkit/shared";
import type { ShopeeResponse } from "@ecomkit/shared";
import { Redis } from "ioredis";
import { createWorkerShopeeAppConfigResolver } from "./shopee-app-config.worker.js";

type RefreshResponse = { access_token?: string; refresh_token?: string; expire_in?: number };
export type WorkerShopeeRefreshTransport = { requestPublic(request: { operation: string; apiPath: string; method: "POST"; body: unknown }): Promise<ShopeeResponse<RefreshResponse>> };

export class WorkerMarketplaceLifecycleConnectionRepository implements MarketplaceLifecycleConnectionRepository {
  async getById(connectionId: string) {
    const row = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { id: true, platform: true, externalShopId: true, status: true, credentialEnvelope: true } });
    return row ? { connectionId: row.id, platform: row.platform, externalShopId: row.externalShopId, status: row.status, credentialEnvelope: row.credentialEnvelope } : null;
  }
  async replaceCredentialEnvelope(input: Readonly<{ connectionId: string; credentialEnvelope: string }>): Promise<void> { await prisma.marketplaceConnection.update({ where: { id: input.connectionId }, data: { credentialEnvelope: input.credentialEnvelope, status: MarketplaceConnectionStatus.ACTIVE } }); }
  async markReauthRequired(connectionId: string): Promise<void> { await prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { status: MarketplaceConnectionStatus.REAUTH_REQUIRED } }); }
}

export class WorkerMarketplaceCredentialCrypto implements MarketplaceCredentialCrypto {
  encrypt(credential: ShopeeCredential): string { return encryptMarketplaceCredential(credential, process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY); }
  decrypt(envelope: string): ShopeeCredential { return decryptMarketplaceCredential(envelope, process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY); }
}

export class WorkerRedisDistributedLockProvider implements DistributedLockProvider {
  private client?: Redis;
  constructor(private readonly redisOptions: { host?: string; port?: number } = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") }) {}
  private redis(): Redis {
    if (this.client) return this.client;
    this.client = new Redis({ host: this.redisOptions.host, port: this.redisOptions.port, maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true });
    this.client.on("error", () => undefined);
    return this.client;
  }
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

export class WorkerShopeeTokenRefreshClient implements ShopeeTokenRefreshClient {
  constructor(private readonly transportFactory?: () => WorkerShopeeRefreshTransport) {}
  async refreshShopToken(input: Readonly<{ shopId: string; refreshToken: string }>) {
    try {
      const config = this.transportFactory ? loadShopeeRuntimeConfig() : await createWorkerShopeeAppConfigResolver().resolve(); const transport = this.transportFactory?.() ?? new ShopeeHttpClient(config);
      const response = await transport.requestPublic<RefreshResponse>({ operation: "SHOPEE_TOKEN_REFRESH", apiPath: "/api/v2/auth/access_token/get", method: "POST", body: { refresh_token: input.refreshToken, partner_id: Number(config.partnerId), shop_id: Number(input.shopId) } });
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

export const workerSystemClock: Clock = { now: () => new Date() };

export function createWorkerShopeeCredentialLifecycle(input: Readonly<{ repository?: MarketplaceLifecycleConnectionRepository; crypto?: MarketplaceCredentialCrypto; locks?: WorkerRedisDistributedLockProvider; refreshClient?: ShopeeTokenRefreshClient; clock?: Clock; refreshSkewSeconds?: number; refreshLockTtlMs?: number }> = {}): { lifecycle: ShopeeCredentialLifecycle; locks: WorkerRedisDistributedLockProvider } {
  const locks = input.locks ?? new WorkerRedisDistributedLockProvider();
  return {
    lifecycle: new ShopeeCredentialLifecycle(input.repository ?? new WorkerMarketplaceLifecycleConnectionRepository(), input.crypto ?? new WorkerMarketplaceCredentialCrypto(), locks, input.refreshClient ?? new WorkerShopeeTokenRefreshClient(), input.clock ?? workerSystemClock, { refreshSkewSeconds: input.refreshSkewSeconds ?? Number(process.env.SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS ?? "300"), refreshLockTtlMs: input.refreshLockTtlMs ?? Number(process.env.SHOPEE_REFRESH_LOCK_TTL_MS ?? "30000") }),
    locks,
  };
}
