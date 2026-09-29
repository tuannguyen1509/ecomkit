import { ConflictException, Inject, Injectable, OnModuleDestroy, Optional, ServiceUnavailableException } from "@nestjs/common";
import { MarketplaceLifecycleError, ShopeeCredentialLifecycle } from "@ecomkit/marketplace-server";
import { loadShopeeRuntimeConfig, ShopeeHttpClient } from "@ecomkit/shared";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ApiMarketplaceCredentialCrypto, ApiShopeeTokenRefreshClient, PrismaMarketplaceLifecycleConnectionRepository, RedisDistributedLockProvider, systemClock, type ApiShopeeRefreshClient } from "./shopee-lifecycle.adapters.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";

export type ValidShopeeCredential = { accessToken: string; shopId: string; accessTokenExpiresAt: string };

@Injectable()
export class ShopeeTokenService implements OnModuleDestroy {
  private readonly locks = new RedisDistributedLockProvider();
  private lifecycle?: ShopeeCredentialLifecycle;

  constructor(
    @Inject(MarketplaceCredentialService) private readonly credentials: MarketplaceCredentialService,
    @Optional() private readonly clientFactory?: () => ApiShopeeRefreshClient,
    @Optional() @Inject(MarketplaceProviderConfigService) private readonly providerConfigs?: MarketplaceProviderConfigService,
  ) {}

  async ensureValidAccessToken(connectionId: string): Promise<ValidShopeeCredential> {
    try {
      return await this.core().ensureValidAccessToken(connectionId);
    } catch (error) {
      if (error instanceof MarketplaceLifecycleError) throw this.toNestError(error);
      throw new ServiceUnavailableException({ errorCode: "SHOPEE_REFRESH_FAILED", message: "Shopee credential refresh failed temporarily." });
    }
  }

  async onModuleDestroy(): Promise<void> { await this.locks.dispose(); }

  private core(): ShopeeCredentialLifecycle {
    if (this.lifecycle) return this.lifecycle;
    return this.lifecycle = new ShopeeCredentialLifecycle(
      new PrismaMarketplaceLifecycleConnectionRepository(),
      new ApiMarketplaceCredentialCrypto(this.credentials),
      this.locks,
      new ApiShopeeTokenRefreshClient(this.clientFactory, this.providerConfigs ? () => this.providerConfigs!.resolveRuntime() : undefined),
      systemClock,
      {
        refreshSkewSeconds: Number(process.env.SHOPEE_ACCESS_TOKEN_REFRESH_SKEW_SECONDS ?? "300"),
        refreshLockTtlMs: Number(process.env.SHOPEE_REFRESH_LOCK_TTL_MS ?? "30000"),
      },
    );
  }

  private toNestError(error: MarketplaceLifecycleError): Error {
    if (error.code === "SHOPEE_REFRESH_LOCK_BUSY") return new ConflictException({ errorCode: "SHOPEE_REFRESH_IN_PROGRESS", message: "Shopee credential refresh is already in progress." });
    if (error.code === "SHOPEE_REFRESH_LOCK_UNAVAILABLE" || error.retryable) {
      return new ServiceUnavailableException({ errorCode: error.code === "SHOPEE_REFRESH_FAILED" ? "SHOPEE_REFRESH_TRANSIENT_FAILURE" : error.code, message: "Shopee credential refresh cannot run now.", ...(error.requestId ? { requestId: error.requestId } : {}) });
    }
    if (error.code === "SHOPEE_CONNECTION_NOT_FOUND") return new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_NOT_FOUND", message: "Marketplace connection was not found." });
    if (error.code === "SHOPEE_REAUTH_REQUIRED" || error.code === "SHOPEE_REFRESH_TOKEN_EXPIRED") return new ConflictException({ errorCode: "SHOPEE_REAUTH_REQUIRED", message: "Shopee connection must be reauthorized by an administrator." });
    return new ConflictException({ errorCode: error.code, message: error.code === "SHOPEE_CREDENTIAL_SHOP_MISMATCH" ? "Shopee connection credential is invalid." : "Shopee credential refresh failed." });
  }
}
