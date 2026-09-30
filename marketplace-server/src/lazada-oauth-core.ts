import { randomBytes } from "node:crypto";
import { encryptMarketplaceCredential, type MarketplaceShopCredential } from "@ecomkit/shared";
import {
  LAZADA_AUTHORIZATION_URL,
  LazadaHttpClientCore,
  type LazadaResponseEnvelope
} from "./lazada-http-client-core.js";
import { LazadaHttpError } from "./lazada-errors.js";

export const LAZADA_TOKEN_CREATE_PATH = "/auth/token/create" as const;
export const DEFAULT_LAZADA_OAUTH_STATE_TTL_SECONDS = 600;

export type LazadaOAuthConfig = Readonly<{
  appKey: string;
  redirectUri: string;
  stateTtlSeconds?: number;
  forceAuth?: boolean;
}>;

export type LazadaOAuthStateContext = Readonly<{
  platform: "LAZADA";
  initiatingUserId: string;
  region: "VN";
  redirectUri: string;
  createdAt: string;
}>;

export interface LazadaOAuthStateStore {
  save(state: string, context: LazadaOAuthStateContext, ttlSeconds: number): Promise<void>;
  consume(state: string): Promise<LazadaOAuthStateContext | null>;
}

export type LazadaCountryUserInfo = Readonly<{
  country: string;
  user_id: string | number;
  seller_id: string | number;
  short_code?: string;
}>;

export type LazadaTokenEnvelope = LazadaResponseEnvelope & Readonly<{
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  account?: unknown;
  country?: unknown;
  country_user_info?: unknown;
  account_platform?: unknown;
}>;

export type LazadaNormalizedToken = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  country?: string;
  account?: string;
  accountPlatform?: string;
  countryUserInfo: readonly LazadaCountryUserInfo[];
}>;

export type LazadaTokenAcquisition = Readonly<{
  platform: "LAZADA";
  externalShopId: string;
  credential: MarketplaceShopCredential;
  safeResult: Readonly<{
    authorized: true;
    platform: "LAZADA";
    externalShopId: string;
    country: "vn";
    sellerId: string;
    userId: string;
    shortCode?: string;
    accountPlatform?: string;
    accessTokenPresent: true;
    refreshTokenPresent: true;
    accessExpiresAt: string;
    refreshExpiresAt: string;
    requestId?: string;
  }>;
}>;

export class LazadaOAuthError extends Error {
  readonly retryable: boolean;
  constructor(
    public readonly code: string,
    retryable = false,
    public readonly requestId?: string,
    public readonly providerCode?: string,
    public readonly providerMessage?: string,
    public readonly httpStatus?: number
  ) {
    super(code);
    this.name = "LazadaOAuthError";
    this.retryable = retryable;
  }
  toJSON(): object { return { name: this.name, code: this.code, retryable: this.retryable, ...(this.requestId ? { requestId: this.requestId } : {}), ...(this.providerCode ? { providerCode: this.providerCode } : {}), ...(this.providerMessage ? { providerMessage: this.providerMessage } : {}), ...(this.httpStatus !== undefined ? { httpStatus: this.httpStatus } : {}) }; }
}

export class LazadaTokenCreateClient {
  constructor(private readonly http: LazadaHttpClientCore) {}
  async create(authorizationCode: string): Promise<Readonly<{ envelope: LazadaTokenEnvelope; requestId?: string }>> {
    const result = await this.http.request<unknown, LazadaTokenEnvelope>({
      operation: "LAZADA_TOKEN_CREATE",
      target: "TOKEN",
      apiPath: LAZADA_TOKEN_CREATE_PATH,
      method: "POST",
      params: { code: authorizationCode }
    });
    return { envelope: result.envelope, ...(result.requestId ? { requestId: result.requestId } : {}) };
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

export function normalizeLazadaTokenEnvelope(envelope: LazadaTokenEnvelope, nowMs: number): LazadaNormalizedToken {
  const accessToken = nonEmptyString(envelope.access_token);
  const refreshToken = nonEmptyString(envelope.refresh_token);
  const expiresIn = positiveInteger(envelope.expires_in);
  const refreshExpiresIn = positiveInteger(envelope.refresh_expires_in);
  if (!accessToken || !refreshToken || !expiresIn || !refreshExpiresIn || !Number.isFinite(nowMs)) {
    throw new LazadaOAuthError("LAZADA_TOKEN_RESPONSE_INVALID");
  }
  if (!Array.isArray(envelope.country_user_info) || envelope.country_user_info.length === 0) {
    throw new LazadaOAuthError("LAZADA_TOKEN_RESPONSE_INVALID");
  }
  const countryUserInfo = envelope.country_user_info.map((entry): LazadaCountryUserInfo => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new LazadaOAuthError("LAZADA_TOKEN_RESPONSE_INVALID");
    const record = entry as Record<string, unknown>;
    const country = nonEmptyString(record.country);
    const userId = identifier(record.user_id);
    const sellerId = identifier(record.seller_id);
    const shortCode = nonEmptyString(record.short_code);
    if (!country || !userId || !sellerId) throw new LazadaOAuthError("LAZADA_TOKEN_RESPONSE_INVALID");
    return { country: country.toLowerCase(), user_id: userId, seller_id: sellerId, ...(shortCode ? { short_code: shortCode } : {}) };
  });
  return {
    accessToken,
    refreshToken,
    expiresIn,
    refreshExpiresIn,
    accessExpiresAt: new Date(Math.trunc(nowMs) + expiresIn * 1000).toISOString(),
    refreshExpiresAt: new Date(Math.trunc(nowMs) + refreshExpiresIn * 1000).toISOString(),
    ...(nonEmptyString(envelope.country) ? { country: nonEmptyString(envelope.country)!.toLowerCase() } : {}),
    ...(nonEmptyString(envelope.account) ? { account: nonEmptyString(envelope.account)! } : {}),
    ...(nonEmptyString(envelope.account_platform) ? { accountPlatform: nonEmptyString(envelope.account_platform)! } : {}),
    countryUserInfo
  };
}

export function selectLazadaVietnamStore(token: LazadaNormalizedToken): Readonly<{ sellerId: string; userId: string; shortCode?: string }> {
  const matches = token.countryUserInfo.filter((entry) => entry.country === "vn");
  if (matches.length === 0) throw new LazadaOAuthError("LAZADA_VIETNAM_STORE_REQUIRED");
  if (matches.length !== 1) throw new LazadaOAuthError("LAZADA_VIETNAM_STORE_AMBIGUOUS");
  const selected = matches[0]!;
  return { sellerId: String(selected.seller_id), userId: String(selected.user_id), ...(selected.short_code ? { shortCode: selected.short_code } : {}) };
}

export function encryptLazadaAcquisitionCredential(acquisition: LazadaTokenAcquisition, encodedEncryptionKey: string): string {
  return encryptMarketplaceCredential(acquisition.credential, encodedEncryptionKey);
}

export class LazadaOAuthCore {
  constructor(
    private readonly config: LazadaOAuthConfig,
    private readonly states: LazadaOAuthStateStore,
    private readonly tokens: LazadaTokenCreateClient,
    private readonly clock: () => number = Date.now,
    private readonly createState: () => string = () => randomBytes(32).toString("base64url")
  ) {}

  async start(initiatingUserId: string): Promise<Readonly<{ authorizationUrl: string; expiresIn: number }>> {
    const { redirectUri, ttl } = this.validatedConfig();
    if (!initiatingUserId) throw new LazadaOAuthError("LAZADA_OAUTH_INPUT_INVALID");
    const state = this.createState();
    if (!state) throw new LazadaOAuthError("LAZADA_OAUTH_STATE_CREATE_FAILED", true);
    const context: LazadaOAuthStateContext = {
      platform: "LAZADA",
      initiatingUserId,
      region: "VN",
      redirectUri,
      createdAt: new Date(this.clock()).toISOString()
    };
    try { await this.states.save(state, context, ttl); }
    catch { throw new LazadaOAuthError("LAZADA_OAUTH_STATE_STORE_UNAVAILABLE", true); }
    const url = new URL(LAZADA_AUTHORIZATION_URL);
    url.searchParams.set("response_type", "code");
    if (this.config.forceAuth !== false) url.searchParams.set("force_auth", "true");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("client_id", this.config.appKey);
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString(), expiresIn: ttl };
  }

  async callback(input: Readonly<{ code?: string; state?: string }>): Promise<LazadaTokenAcquisition> {
    const code = nonEmptyString(input.code);
    const state = nonEmptyString(input.state);
    if (!code || !state) throw new LazadaOAuthError("LAZADA_OAUTH_CALLBACK_INVALID");
    let context: LazadaOAuthStateContext | null;
    try { context = await this.states.consume(state); }
    catch { throw new LazadaOAuthError("LAZADA_OAUTH_STATE_STORE_UNAVAILABLE", true); }
    if (!context || context.platform !== "LAZADA") throw new LazadaOAuthError("LAZADA_OAUTH_STATE_INVALID");
    const { redirectUri } = this.validatedConfig();
    if (context.region !== "VN" || context.redirectUri !== redirectUri) throw new LazadaOAuthError("LAZADA_OAUTH_STATE_INVALID");
    let tokenResponse: Awaited<ReturnType<LazadaTokenCreateClient["create"]>>;
    try { tokenResponse = await this.tokens.create(code); }
    catch (error) {
      if (error instanceof LazadaHttpError) throw new LazadaOAuthError("LAZADA_TOKEN_CREATE_FAILED", error.retryable, error.requestId, error.providerCode, error.providerMessage, error.httpStatus);
      if (error instanceof LazadaOAuthError) throw error;
      throw new LazadaOAuthError("LAZADA_TOKEN_CREATE_FAILED", false);
    }
    const token = normalizeLazadaTokenEnvelope(tokenResponse.envelope, this.clock());
    const store = selectLazadaVietnamStore(token);
    const externalShopId = `vn:${store.sellerId}`;
    const credential: MarketplaceShopCredential = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenExpiresAt: token.accessExpiresAt,
      refreshTokenExpiresAt: token.refreshExpiresAt,
      providerMetadata: {
        country: "vn",
        sellerId: store.sellerId,
        userId: store.userId,
        ...(store.shortCode ? { shortCode: store.shortCode } : {}),
        ...(token.accountPlatform ? { accountPlatform: token.accountPlatform } : {}),
        credentialSource: "OAUTH",
        refreshOwnership: "ECOMKIT"
      }
    };
    return {
      platform: "LAZADA",
      externalShopId,
      credential,
      safeResult: {
        authorized: true,
        platform: "LAZADA",
        externalShopId,
        country: "vn",
        sellerId: store.sellerId,
        userId: store.userId,
        ...(store.shortCode ? { shortCode: store.shortCode } : {}),
        ...(token.accountPlatform ? { accountPlatform: token.accountPlatform } : {}),
        accessTokenPresent: true,
        refreshTokenPresent: true,
        accessExpiresAt: token.accessExpiresAt,
        refreshExpiresAt: token.refreshExpiresAt,
        ...(tokenResponse.requestId ? { requestId: tokenResponse.requestId } : {})
      }
    };
  }

  private validatedConfig(): { redirectUri: string; ttl: number } {
    const ttl = this.config.stateTtlSeconds ?? DEFAULT_LAZADA_OAUTH_STATE_TTL_SECONDS;
    let redirectUri: URL;
    try { redirectUri = new URL(this.config.redirectUri); }
    catch { throw new LazadaOAuthError("LAZADA_OAUTH_CONFIG_INVALID"); }
    if (!this.config.appKey || !Number.isInteger(ttl) || ttl <= 0) throw new LazadaOAuthError("LAZADA_OAUTH_CONFIG_INVALID");
    return { redirectUri: redirectUri.toString(), ttl };
  }
}
