import {
  LazadaCredentialLifecycle,
  LazadaHttpClientCore,
  LazadaLifecycleError,
  LazadaTokenRefreshHttpClient,
  type Clock,
  type DistributedLockProvider,
  type LazadaTokenRefreshClient,
  type MarketplaceCredentialCrypto,
  type MarketplaceLifecycleConnectionRepository,
} from "@ecomkit/marketplace-server";
import { ApiMarketplaceCredentialCrypto, PrismaMarketplaceLifecycleConnectionRepository, RedisDistributedLockProvider, systemClock } from "./shopee-lifecycle.adapters.js";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";

export type LazadaAppConfig = Readonly<{ appKey: string; appSecret: string; timeoutMs: number }>;
export interface LazadaAppConfigProvider { resolve(): Promise<LazadaAppConfig>; }

export class ApiEnvironmentLazadaAppConfigProvider implements LazadaAppConfigProvider {
  async resolve(): Promise<LazadaAppConfig> {
    const appKey = process.env.LAZADA_APP_KEY, appSecret = process.env.LAZADA_APP_SECRET;
    const timeoutMs = Number(process.env.LAZADA_HTTP_TIMEOUT_MS ?? "10000");
    if (!appKey || !appSecret || !Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new LazadaLifecycleError("LAZADA_CONFIG_INVALID", false);
    return { appKey, appSecret, timeoutMs };
  }
}

export class ApiLazadaTokenRefreshClient implements LazadaTokenRefreshClient {
  constructor(private readonly config: LazadaAppConfigProvider = new ApiEnvironmentLazadaAppConfigProvider()) {}
  async refresh(refreshToken: string) { const c = await this.config.resolve(); return new LazadaTokenRefreshHttpClient(new LazadaHttpClientCore(c)).refresh(refreshToken); }
}

export function createApiLazadaCredentialLifecycle(input: Readonly<{
  credentialService?: MarketplaceCredentialService; repository?: MarketplaceLifecycleConnectionRepository; crypto?: MarketplaceCredentialCrypto;
  locks?: DistributedLockProvider; refreshClient?: LazadaTokenRefreshClient; clock?: Clock; refreshSkewSeconds?: number; refreshLockTtlMs?: number;
}> = {}): LazadaCredentialLifecycle {
  const crypto = input.crypto ?? (input.credentialService ? new ApiMarketplaceCredentialCrypto(input.credentialService) : undefined);
  if (!crypto) throw new LazadaLifecycleError("LAZADA_ENCRYPTION_CONFIG_INVALID", false);
  return new LazadaCredentialLifecycle(input.repository ?? new PrismaMarketplaceLifecycleConnectionRepository(), crypto,
    input.locks ?? new RedisDistributedLockProvider(), input.refreshClient ?? new ApiLazadaTokenRefreshClient(), input.clock ?? systemClock,
    { refreshSkewSeconds: input.refreshSkewSeconds ?? Number(process.env.LAZADA_ACCESS_TOKEN_REFRESH_SKEW_SECONDS ?? "300"), refreshLockTtlMs: input.refreshLockTtlMs ?? Number(process.env.LAZADA_REFRESH_LOCK_TTL_MS ?? "30000") });
}
