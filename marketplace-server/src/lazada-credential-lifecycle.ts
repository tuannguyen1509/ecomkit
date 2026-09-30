import type {
  Clock,
  DistributedLockProvider,
  MarketplaceCredentialCrypto,
  MarketplaceLifecycleConnection,
  MarketplaceLifecycleConnectionRepository,
  ShopeeCredential,
} from "./lifecycle-contracts.js";
import { LazadaHttpError } from "./lazada-errors.js";
import { LazadaHttpClientCore, type LazadaResponseEnvelope } from "./lazada-http-client-core.js";

export const LAZADA_TOKEN_REFRESH_PATH = "/auth/token/refresh" as const;

export type LazadaAccessCredential = Readonly<{ accessToken: string; externalShopId: string; accessTokenExpiresAt: string }>;
export type LazadaRefreshResult = Readonly<{ accessToken?: string; refreshToken?: string; expiresIn?: number; refreshExpiresIn?: number; requestId?: string }>;
export interface LazadaTokenRefreshClient { refresh(refreshToken: string): Promise<LazadaRefreshResult>; }

export class LazadaLifecycleError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly requestId?: string) {
    super(code); this.name = "LazadaLifecycleError";
  }
  toJSON(): object { return { name: this.name, code: this.code, retryable: this.retryable, ...(this.requestId ? { requestId: this.requestId } : {}) }; }
}

export class LazadaTokenRefreshHttpClient implements LazadaTokenRefreshClient {
  constructor(private readonly http: LazadaHttpClientCore) {}
  async refresh(refreshToken: string): Promise<LazadaRefreshResult> {
    try {
      const result = await this.http.request<unknown, LazadaResponseEnvelope>({
        operation: "LAZADA_TOKEN_REFRESH", target: "TOKEN", apiPath: LAZADA_TOKEN_REFRESH_PATH,
        method: "POST", params: { refresh_token: refreshToken },
      });
      return {
        accessToken: typeof result.envelope.access_token === "string" ? result.envelope.access_token : undefined,
        refreshToken: typeof result.envelope.refresh_token === "string" ? result.envelope.refresh_token : undefined,
        expiresIn: typeof result.envelope.expires_in === "number" ? result.envelope.expires_in : undefined,
        refreshExpiresIn: typeof result.envelope.refresh_expires_in === "number" ? result.envelope.refresh_expires_in : undefined,
        ...(result.requestId ? { requestId: result.requestId } : {}),
      };
    } catch (error) {
      if (error instanceof LazadaHttpError) throw new LazadaLifecycleError("LAZADA_REFRESH_FAILED", error.retryable, error.requestId);
      if (error instanceof LazadaLifecycleError) throw error;
      throw new LazadaLifecycleError("LAZADA_REFRESH_FAILED", false);
    }
  }
}

export type LazadaCredentialLifecycleConfig = Readonly<{ refreshSkewSeconds: number; refreshLockTtlMs: number }>;
type Loaded = Readonly<{ connection: MarketplaceLifecycleConnection; credential: ShopeeCredential & Required<Pick<ShopeeCredential, "accessToken" | "tokenExpiresAt">> }>;

export class LazadaCredentialLifecycle {
  constructor(
    private readonly connections: MarketplaceLifecycleConnectionRepository,
    private readonly crypto: MarketplaceCredentialCrypto,
    private readonly locks: DistributedLockProvider,
    private readonly refreshClient: LazadaTokenRefreshClient,
    private readonly clock: Clock,
    private readonly config: LazadaCredentialLifecycleConfig,
  ) {
    if (!Number.isFinite(config.refreshSkewSeconds) || config.refreshSkewSeconds < 0) throw new Error("refreshSkewSeconds must be non-negative");
    if (!Number.isFinite(config.refreshLockTtlMs) || config.refreshLockTtlMs <= 0) throw new Error("refreshLockTtlMs must be positive");
  }

  async ensureValidAccessToken(connectionId: string): Promise<LazadaAccessCredential> {
    const initial = await this.load(connectionId);
    if (this.accessValid(initial.credential)) return this.access(initial);
    if (this.external(initial.credential)) throw new LazadaLifecycleError("EXTERNAL_ACCESS_TOKEN_EXPIRED", false);
    await this.assertRefreshable(connectionId, initial.credential);
    const key = `lazada-refresh-lock-${connectionId}`;
    let lock;
    try { lock = await this.locks.acquire(key, this.config.refreshLockTtlMs); }
    catch { throw new LazadaLifecycleError("LAZADA_REFRESH_LOCK_UNAVAILABLE", true); }
    if (lock.kind === "unavailable") throw new LazadaLifecycleError("LAZADA_REFRESH_LOCK_UNAVAILABLE", true);
    if (lock.kind === "busy") {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        const current = await this.load(connectionId);
        if (this.accessValid(current.credential)) return this.access(current);
      }
      throw new LazadaLifecycleError("LAZADA_REFRESH_LOCK_BUSY", true);
    }
    try {
      const current = await this.load(connectionId);
      if (this.accessValid(current.credential)) return this.access(current);
      if (this.external(current.credential)) throw new LazadaLifecycleError("EXTERNAL_TOKEN_REFRESH_FORBIDDEN", false);
      await this.assertRefreshable(connectionId, current.credential);
      let response: LazadaRefreshResult;
      try { response = await this.refreshClient.refresh(current.credential.refreshToken!); }
      catch (error) { if (error instanceof LazadaLifecycleError) throw error; throw new LazadaLifecycleError("LAZADA_REFRESH_FAILED", false); }
      if (!this.validResponse(response)) throw new LazadaLifecycleError("LAZADA_REFRESH_RESPONSE_INVALID", false, response.requestId);
      const now = this.clock.now().valueOf();
      const oldRefreshExpiry = new Date(current.credential.refreshTokenExpiresAt!).valueOf();
      const providerRefreshExpiry = now + response.refreshExpiresIn * 1000;
      const next: ShopeeCredential = {
        accessToken: response.accessToken, refreshToken: response.refreshToken,
        tokenExpiresAt: new Date(now + response.expiresIn * 1000).toISOString(),
        // Lazada refresh does not reset the original refresh-token lifetime.
        refreshTokenExpiresAt: new Date(Math.min(oldRefreshExpiry, providerRefreshExpiry)).toISOString(),
        providerMetadata: current.credential.providerMetadata,
      };
      let envelope: string;
      try { envelope = this.crypto.encrypt(next); }
      catch { throw new LazadaLifecycleError("LAZADA_CREDENTIAL_PERSIST_FAILED", false, response.requestId); }
      try { await this.connections.replaceCredentialEnvelope({ connectionId, credentialEnvelope: envelope }); }
      catch { throw new LazadaLifecycleError("LAZADA_CREDENTIAL_PERSIST_FAILED", false, response.requestId); }
      return { accessToken: response.accessToken, externalShopId: current.connection.externalShopId, accessTokenExpiresAt: next.tokenExpiresAt! };
    } finally { await lock.release().catch(() => undefined); }
  }

  private async load(connectionId: string): Promise<Loaded> {
    const connection = await this.connections.getById(connectionId);
    if (!connection) throw new LazadaLifecycleError("LAZADA_CONNECTION_NOT_FOUND", false);
    if (connection.platform !== "LAZADA") throw new LazadaLifecycleError("LAZADA_CONNECTION_PLATFORM_INVALID", false);
    if (connection.status === "REAUTH_REQUIRED") throw new LazadaLifecycleError("LAZADA_REAUTH_REQUIRED", false);
    if (connection.status !== "ACTIVE") throw new LazadaLifecycleError("LAZADA_CONNECTION_NOT_ACTIVE", false);
    if (!connection.credentialEnvelope) return this.reauth(connectionId);
    let credential: ShopeeCredential;
    try { credential = this.crypto.decrypt(connection.credentialEnvelope); } catch { return this.reauth(connectionId); }
    if (!credential.accessToken || !credential.tokenExpiresAt || !Number.isFinite(new Date(credential.tokenExpiresAt).valueOf())) return this.reauth(connectionId);
    const sellerId = credential.providerMetadata?.sellerId;
    if (credential.providerMetadata?.country !== "vn" || typeof sellerId !== "string" || `vn:${sellerId}` !== connection.externalShopId) {
      throw new LazadaLifecycleError("LAZADA_CREDENTIAL_STORE_MISMATCH", false);
    }
    return { connection, credential: credential as Loaded["credential"] };
  }
  private accessValid(c: Loaded["credential"]): boolean { return new Date(c.tokenExpiresAt).valueOf() - this.clock.now().valueOf() > this.config.refreshSkewSeconds * 1000; }
  private external(c: ShopeeCredential): boolean { return c.providerMetadata?.credentialSource === "EXTERNAL_IMPORT" && c.providerMetadata?.refreshOwnership === "EXTERNAL"; }
  private async assertRefreshable(connectionId: string, c: ShopeeCredential): Promise<void> {
    if (!c.refreshToken) throw new LazadaLifecycleError("LAZADA_REFRESH_TOKEN_MISSING", false);
    if (!c.refreshTokenExpiresAt || !Number.isFinite(new Date(c.refreshTokenExpiresAt).valueOf()) || new Date(c.refreshTokenExpiresAt).valueOf() <= this.clock.now().valueOf()) {
      return this.reauth(connectionId);
    }
  }
  private access(v: Loaded): LazadaAccessCredential { return { accessToken: v.credential.accessToken, externalShopId: v.connection.externalShopId, accessTokenExpiresAt: v.credential.tokenExpiresAt }; }
  private validResponse(r: LazadaRefreshResult): r is Required<Pick<LazadaRefreshResult, "accessToken" | "refreshToken" | "expiresIn" | "refreshExpiresIn">> & LazadaRefreshResult {
    return !!r.accessToken && !!r.refreshToken && Number.isInteger(r.expiresIn) && r.expiresIn! > 0 && Number.isInteger(r.refreshExpiresIn) && r.refreshExpiresIn! > 0;
  }
  private async reauth(connectionId: string): Promise<never> {
    try { await this.connections.markReauthRequired(connectionId); } catch { throw new LazadaLifecycleError("LAZADA_CREDENTIAL_PERSIST_FAILED", true); }
    throw new LazadaLifecycleError("LAZADA_REAUTH_REQUIRED", false);
  }
}
