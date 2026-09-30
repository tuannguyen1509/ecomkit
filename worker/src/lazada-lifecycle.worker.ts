import {
  LazadaCredentialLifecycle, LazadaHttpClientCore, LazadaLifecycleError, LazadaTokenRefreshHttpClient,
  type Clock, type DistributedLockProvider, type LazadaTokenRefreshClient, type MarketplaceCredentialCrypto, type MarketplaceLifecycleConnectionRepository,
} from "@ecomkit/marketplace-server";
import { WorkerMarketplaceCredentialCrypto, WorkerMarketplaceLifecycleConnectionRepository, WorkerRedisDistributedLockProvider, workerSystemClock } from "./shopee-lifecycle.worker.js";

export interface WorkerLazadaAppConfigProvider { resolve(): Promise<Readonly<{ appKey: string; appSecret: string; timeoutMs: number }>>; }
export class WorkerEnvironmentLazadaAppConfigProvider implements WorkerLazadaAppConfigProvider {
  async resolve() { const appKey = process.env.LAZADA_APP_KEY, appSecret = process.env.LAZADA_APP_SECRET; const timeoutMs = Number(process.env.LAZADA_HTTP_TIMEOUT_MS ?? "10000"); if (!appKey || !appSecret || !Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new LazadaLifecycleError("LAZADA_CONFIG_INVALID", false); return { appKey, appSecret, timeoutMs }; }
}
export class WorkerLazadaTokenRefreshClient implements LazadaTokenRefreshClient {
  constructor(private readonly config: WorkerLazadaAppConfigProvider = new WorkerEnvironmentLazadaAppConfigProvider()) {}
  async refresh(refreshToken: string) { const c = await this.config.resolve(); return new LazadaTokenRefreshHttpClient(new LazadaHttpClientCore(c)).refresh(refreshToken); }
}
export function createWorkerLazadaCredentialLifecycle(input: Readonly<{ repository?: MarketplaceLifecycleConnectionRepository; crypto?: MarketplaceCredentialCrypto; locks?: DistributedLockProvider; refreshClient?: LazadaTokenRefreshClient; clock?: Clock; refreshSkewSeconds?: number; refreshLockTtlMs?: number }> = {}): LazadaCredentialLifecycle {
  return new LazadaCredentialLifecycle(input.repository ?? new WorkerMarketplaceLifecycleConnectionRepository(), input.crypto ?? new WorkerMarketplaceCredentialCrypto(), input.locks ?? new WorkerRedisDistributedLockProvider(), input.refreshClient ?? new WorkerLazadaTokenRefreshClient(), input.clock ?? workerSystemClock, { refreshSkewSeconds: input.refreshSkewSeconds ?? Number(process.env.LAZADA_ACCESS_TOKEN_REFRESH_SKEW_SECONDS ?? "300"), refreshLockTtlMs: input.refreshLockTtlMs ?? Number(process.env.LAZADA_REFRESH_LOCK_TTL_MS ?? "30000") });
}
