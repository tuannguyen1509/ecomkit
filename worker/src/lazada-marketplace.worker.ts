import { Platform, prisma } from "@ecomkit/database";
import {
  LazadaCredentialLifecycle,
  LazadaHttpClientCore,
  LazadaMarketplaceAdapter,
  LazadaOrderClient,
  LazadaTokenRefreshHttpClient,
  type LazadaAccessTokenLifecycle,
  type LazadaHttpClientConfig,
  type LazadaOrderHttpClient,
  type LazadaTokenRefreshClient,
  type LazadaTransport,
} from "@ecomkit/marketplace-server";
import { decryptMarketplaceCredential } from "@ecomkit/shared";
import {
  WorkerMarketplaceCredentialCrypto,
  WorkerMarketplaceLifecycleConnectionRepository,
  WorkerRedisDistributedLockProvider,
  workerSystemClock,
} from "./shopee-lifecycle.worker.js";

export class WorkerLazadaConfigError extends Error {
  readonly code = "LAZADA_CONFIG_MISSING";
  readonly retryable = false;
  constructor() { super("LAZADA_CONFIG_MISSING"); this.name = "WorkerLazadaConfigError"; }
}

export interface WorkerLazadaConfigResolver { resolve(): Promise<LazadaHttpClientConfig>; }

/** Maps generic provider storage names to Lazada's App Key/App Secret terminology. */
export function createWorkerLazadaConfigResolver(env: Record<string, string | undefined> = process.env): WorkerLazadaConfigResolver {
  return {
    async resolve() {
      const row = await prisma.marketplaceProviderConfig.findUnique({
        where: { platform: Platform.LAZADA },
        select: { environment: true, partnerId: true, partnerSecretEnvelope: true, isEnabled: true },
      });
      if (!row?.isEnabled || row.environment.toLowerCase() !== "production") throw new WorkerLazadaConfigError();
      try {
        const secret = decryptMarketplaceCredential(row.partnerSecretEnvelope, env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY).providerMetadata?.partnerSecret;
        if (!row.partnerId || typeof secret !== "string" || !secret) throw new WorkerLazadaConfigError();
        return { appKey: row.partnerId, appSecret: secret, timeoutMs: Number(env.LAZADA_HTTP_TIMEOUT_MS ?? "30000") };
      } catch (error) {
        if (error instanceof WorkerLazadaConfigError) throw error;
        throw new WorkerLazadaConfigError();
      }
    },
  };
}

class LazyLazadaHttpClient implements LazadaOrderHttpClient {
  constructor(private readonly config: WorkerLazadaConfigResolver, private readonly transport?: LazadaTransport) {}
  async request<T = unknown, TEnvelope extends import("@ecomkit/marketplace-server").LazadaResponseEnvelope<T> = import("@ecomkit/marketplace-server").LazadaResponseEnvelope<T>>(input: import("@ecomkit/marketplace-server").LazadaLowLevelRequest) {
    return new LazadaHttpClientCore(await this.config.resolve(), this.transport).request<T, TEnvelope>(input);
  }
}

class LazyLazadaRefreshClient implements LazadaTokenRefreshClient {
  constructor(private readonly config: WorkerLazadaConfigResolver, private readonly transport?: LazadaTransport) {}
  async refresh(refreshToken: string) {
    return new LazadaTokenRefreshHttpClient(new LazadaHttpClientCore(await this.config.resolve(), this.transport)).refresh(refreshToken);
  }
}

export function createWorkerLazadaAdapter(input: Readonly<{
  orderClient?: LazadaOrderClient;
  configResolver?: WorkerLazadaConfigResolver;
  transport?: LazadaTransport;
  lifecycle?: LazadaAccessTokenLifecycle;
}> = {}): LazadaMarketplaceAdapter {
  if (input.orderClient) return new LazadaMarketplaceAdapter(input.orderClient);
  const config = input.configResolver ?? createWorkerLazadaConfigResolver();
  const locks = new WorkerRedisDistributedLockProvider();
  const lifecycle = input.lifecycle ?? new LazadaCredentialLifecycle(
    new WorkerMarketplaceLifecycleConnectionRepository(),
    new WorkerMarketplaceCredentialCrypto(),
    locks,
    new LazyLazadaRefreshClient(config, input.transport),
    workerSystemClock,
    {
      refreshSkewSeconds: Number(process.env.LAZADA_ACCESS_TOKEN_REFRESH_SKEW_SECONDS ?? "300"),
      refreshLockTtlMs: Number(process.env.LAZADA_REFRESH_LOCK_TTL_MS ?? "30000"),
    },
  );
  return new LazadaMarketplaceAdapter(new LazadaOrderClient(new LazyLazadaHttpClient(config, input.transport), lifecycle));
}
