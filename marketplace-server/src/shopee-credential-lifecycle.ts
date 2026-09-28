import {
  type Clock,
  type DistributedLockProvider,
  type MarketplaceCredentialCrypto,
  type MarketplaceLifecycleConnection,
  type MarketplaceLifecycleConnectionRepository,
  MarketplaceLifecycleError,
  type ShopeeAccessCredential,
  type ShopeeCredential,
  type ShopeeTokenRefreshClient,
} from "./lifecycle-contracts.js";

const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type ShopeeCredentialLifecycleConfig = Readonly<{
  refreshSkewSeconds: number;
  refreshLockTtlMs: number;
}>;

type LoadedCredential = Readonly<{
  connection: MarketplaceLifecycleConnection;
  credential: Required<Pick<ShopeeCredential, "accessToken" | "refreshToken" | "tokenExpiresAt" | "refreshTokenExpiresAt">> & ShopeeCredential;
}>;

/**
 * Server-only lifecycle orchestration. Its dependencies are deliberately
 * infrastructure-neutral so API and Worker can share this one implementation.
 */
export class ShopeeCredentialLifecycle {
  public constructor(
    private readonly connections: MarketplaceLifecycleConnectionRepository,
    private readonly crypto: MarketplaceCredentialCrypto,
    private readonly locks: DistributedLockProvider,
    private readonly refreshClient: ShopeeTokenRefreshClient,
    private readonly clock: Clock,
    private readonly config: ShopeeCredentialLifecycleConfig,
  ) {
    if (!Number.isFinite(config.refreshSkewSeconds) || config.refreshSkewSeconds < 0) throw new Error("refreshSkewSeconds must be a non-negative finite number");
    if (!Number.isFinite(config.refreshLockTtlMs) || config.refreshLockTtlMs <= 0) throw new Error("refreshLockTtlMs must be a positive finite number");
  }

  public async ensureValidAccessToken(connectionId: string): Promise<ShopeeAccessCredential> {
    const initial = await this.load(connectionId);
    if (this.isAccessTokenValid(initial.credential)) return this.toAccessCredential(initial);
    if (this.isRefreshTokenExpired(initial.credential)) return this.reauthRequired(connectionId);

    const key = `shopee-refresh-lock-${connectionId}`;
    let lock;
    try {
      lock = await this.locks.acquire(key, this.config.refreshLockTtlMs);
    } catch {
      throw new MarketplaceLifecycleError("SHOPEE_REFRESH_LOCK_UNAVAILABLE", true);
    }

    if (lock.kind === "unavailable") throw new MarketplaceLifecycleError("SHOPEE_REFRESH_LOCK_UNAVAILABLE", true);
    if (lock.kind === "busy") {
      // Preserve the previous API lifecycle's bounded 10 x 50ms contention wait.
      // The core polls only its repository; it contains no Redis-specific behavior.
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        const reloaded = await this.load(connectionId);
        if (this.isAccessTokenValid(reloaded.credential)) return this.toAccessCredential(reloaded);
      }
      throw new MarketplaceLifecycleError("SHOPEE_REFRESH_LOCK_BUSY", true);
    }

    try {
      const current = await this.load(connectionId);
      if (this.isAccessTokenValid(current.credential)) return this.toAccessCredential(current);
      if (this.isRefreshTokenExpired(current.credential)) return this.reauthRequired(connectionId);

      let response;
      try {
        response = await this.refreshClient.refreshShopToken({
          shopId: current.connection.externalShopId,
          refreshToken: current.credential.refreshToken,
        });
      } catch (error) {
        if (error instanceof MarketplaceLifecycleError) {
          if (error.code === "SHOPEE_REAUTH_REQUIRED") return this.reauthRequired(connectionId);
          throw error;
        }
        throw new MarketplaceLifecycleError("SHOPEE_REFRESH_FAILED", true);
      }

      if (!this.isRefreshResponseValid(response)) {
        throw new MarketplaceLifecycleError("SHOPEE_REFRESH_RESPONSE_INVALID", false, response.requestId);
      }

      const now = this.clock.now().valueOf();
      const nextCredential: ShopeeCredential = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        tokenExpiresAt: new Date(now + response.expireIn * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_LIFETIME_MS).toISOString(),
        providerMetadata: { shopId: current.connection.externalShopId },
      };
      let envelope: string;
      try {
        envelope = this.crypto.encrypt(nextCredential);
      } catch {
        throw new MarketplaceLifecycleError("SHOPEE_CREDENTIAL_PERSIST_FAILED", true, response.requestId);
      }
      try {
        await this.connections.replaceCredentialEnvelope({ connectionId, credentialEnvelope: envelope });
      } catch {
        throw new MarketplaceLifecycleError("SHOPEE_CREDENTIAL_PERSIST_FAILED", true, response.requestId);
      }
      return {
        accessToken: response.accessToken,
        shopId: current.connection.externalShopId,
        accessTokenExpiresAt: nextCredential.tokenExpiresAt!,
      };
    } finally {
      await lock.release().catch(() => undefined);
    }
  }

  private async load(connectionId: string): Promise<LoadedCredential> {
    const connection = await this.connections.getById(connectionId);
    if (!connection) throw new MarketplaceLifecycleError("SHOPEE_CONNECTION_NOT_FOUND", false);
    if (connection.platform !== "SHOPEE") throw new MarketplaceLifecycleError("SHOPEE_CONNECTION_PLATFORM_INVALID", false);
    if (connection.status === "REAUTH_REQUIRED") throw new MarketplaceLifecycleError("SHOPEE_REAUTH_REQUIRED", false);
    if (connection.status !== "ACTIVE") throw new MarketplaceLifecycleError("SHOPEE_CONNECTION_NOT_ACTIVE", false);
    if (!connection.credentialEnvelope) return this.invalidCredential(connectionId);

    let credential: ShopeeCredential;
    try {
      credential = this.crypto.decrypt(connection.credentialEnvelope);
    } catch {
      return this.invalidCredential(connectionId);
    }
    if (!this.isCredentialComplete(credential)) return this.invalidCredential(connectionId);
    if (credential.providerMetadata?.shopId !== connection.externalShopId) {
      throw new MarketplaceLifecycleError("SHOPEE_CREDENTIAL_SHOP_MISMATCH", false);
    }
    return { connection, credential };
  }

  private isCredentialComplete(credential: ShopeeCredential): credential is LoadedCredential["credential"] {
    return typeof credential.accessToken === "string" && credential.accessToken.length > 0
      && typeof credential.refreshToken === "string" && credential.refreshToken.length > 0
      && typeof credential.tokenExpiresAt === "string" && Number.isFinite(new Date(credential.tokenExpiresAt).valueOf())
      && typeof credential.refreshTokenExpiresAt === "string" && Number.isFinite(new Date(credential.refreshTokenExpiresAt).valueOf())
      && typeof credential.providerMetadata?.shopId === "string" && credential.providerMetadata.shopId.length > 0;
  }

  private isAccessTokenValid(credential: LoadedCredential["credential"]): boolean {
    return new Date(credential.tokenExpiresAt).valueOf() - this.clock.now().valueOf() > this.config.refreshSkewSeconds * 1000;
  }

  private isRefreshTokenExpired(credential: LoadedCredential["credential"]): boolean {
    return new Date(credential.refreshTokenExpiresAt).valueOf() <= this.clock.now().valueOf();
  }

  private toAccessCredential(loaded: LoadedCredential): ShopeeAccessCredential {
    return { accessToken: loaded.credential.accessToken, shopId: loaded.connection.externalShopId, accessTokenExpiresAt: loaded.credential.tokenExpiresAt };
  }

  private async reauthRequired(connectionId: string): Promise<never> {
    try {
      await this.connections.markReauthRequired(connectionId);
    } catch {
      throw new MarketplaceLifecycleError("SHOPEE_CREDENTIAL_PERSIST_FAILED", true);
    }
    throw new MarketplaceLifecycleError("SHOPEE_REAUTH_REQUIRED", false);
  }

  private async invalidCredential(connectionId: string): Promise<never> {
    // Existing API behavior treats an unreadable or incomplete encrypted payload
    // as operator-actionable and transitions the connection to reauthorization.
    return this.reauthRequired(connectionId);
  }

  private isRefreshResponseValid(response: Awaited<ReturnType<ShopeeTokenRefreshClient["refreshShopToken"]>>): response is Readonly<{ accessToken: string; refreshToken: string; expireIn: number; requestId?: string }> {
    return typeof response.accessToken === "string" && response.accessToken.length > 0
      && typeof response.refreshToken === "string" && response.refreshToken.length > 0
      && typeof response.expireIn === "number" && Number.isFinite(response.expireIn) && response.expireIn > 0;
  }
}
