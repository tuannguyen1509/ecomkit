import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { getShopeeBaseUrl, loadShopeeRuntimeConfig, ShopeeHttpClient, ShopeeSigner } from "@ecomkit/shared";
import type { ShopeeEnvironment, ShopeeResponse } from "@ecomkit/shared";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ShopeeOAuthStateStore, type ShopeeOAuthStateContext } from "./shopee-oauth-state.store.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";

type TokenResponse = { access_token?: string; refresh_token?: string; expire_in?: number };
type TokenClient = { requestPublic(request: { operation: string; apiPath: string; method: "POST"; body: unknown }): Promise<ShopeeResponse<TokenResponse>> };
type OAuthConfig = { environment: ShopeeEnvironment; partnerId: string; partnerKey: string; redirectUri: string; ttlSeconds: number };
const AUTH_PATH = "/api/v2/shop/auth_partner";
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function safeInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CALLBACK_INVALID", message: "Shopee callback is invalid." });
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CALLBACK_INVALID", message: "Shopee callback is invalid." });
  return number;
}

export function buildShopeeAuthorizationUrl(config: Pick<OAuthConfig, "environment" | "partnerId" | "partnerKey" | "redirectUri">, state: string, timestamp: number): string {
  const url = new URL(AUTH_PATH, getShopeeBaseUrl(config.environment));
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", new ShopeeSigner(config.partnerId, config.partnerKey).signPublic(AUTH_PATH, timestamp));
  url.searchParams.set("redirect", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function environmentConfig(): OAuthConfig {
  const runtime = loadShopeeRuntimeConfig(); const redirectUri = process.env.SHOPEE_REDIRECT_URI?.trim();
  if (!redirectUri) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." });
  let url: URL; try { url = new URL(redirectUri); } catch { throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." }); }
  if (runtime.environment === "production" && url.protocol !== "https:") throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." });
  const ttlSeconds = Number(process.env.SHOPEE_OAUTH_STATE_TTL_SECONDS ?? "600");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." });
  return { environment: runtime.environment, partnerId: runtime.partnerId, partnerKey: runtime.partnerKey, redirectUri: url.toString(), ttlSeconds };
}

@Injectable()
export class ShopeeOAuthService {
  constructor(@Inject(MarketplaceCredentialService) private readonly credentialService: MarketplaceCredentialService, @Inject(ShopeeOAuthStateStore) private readonly states: ShopeeOAuthStateStore, @Optional() private readonly clientFactory?: () => TokenClient, @Optional() @Inject(MarketplaceProviderConfigService) private readonly providerConfigs?: MarketplaceProviderConfigService, @Optional() private readonly clock: () => number = () => Date.now()) {}
  private async config(): Promise<OAuthConfig> { if (!this.providerConfigs) return environmentConfig(); const resolved = await this.providerConfigs.resolveRuntime(true); const ttlSeconds = Number(process.env.SHOPEE_OAUTH_STATE_TTL_SECONDS ?? "600"); if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." }); return { environment: resolved.environment, partnerId: resolved.partnerId, partnerKey: resolved.partnerKey, redirectUri: resolved.redirectUri!, ttlSeconds }; }
  async start(initiatingUserId: string): Promise<{ authorizationUrl: string; expiresIn: number }> {
    const current = await this.config(); const state = randomBytes(32).toString("base64url");
    const context: ShopeeOAuthStateContext = { platform: "SHOPEE", initiatingUserId, environment: current.environment, redirectUri: current.redirectUri, createdAt: new Date().toISOString() };
    try { await this.states.save(state, context, current.ttlSeconds); } catch { throw new ServiceUnavailableException({ errorCode: "SHOPEE_OAUTH_STATE_STORE_UNAVAILABLE", message: "Shopee authorization cannot be started now." }); }
    const timestamp = Math.floor(this.clock() / 1000);
    return { authorizationUrl: buildShopeeAuthorizationUrl(current, state, timestamp), expiresIn: current.ttlSeconds };
  }
  async callback(input: { code?: string; shopId?: string; state?: string; mainAccountId?: string }): Promise<{ connectionId: string; platform: "SHOPEE"; externalShopId: string; status: "ACTIVE"; requestId?: string }> {
    if (!input.shopId && input.mainAccountId) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_MAIN_ACCOUNT_UNSUPPORTED", message: "Main-account authorization is not supported." });
    if (!input.code || !input.shopId || !input.state) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CALLBACK_INVALID", message: "Shopee callback is invalid." });
    let context: ShopeeOAuthStateContext | null; try { context = await this.states.consume(input.state); } catch { throw new ServiceUnavailableException({ errorCode: "SHOPEE_OAUTH_STATE_STORE_UNAVAILABLE", message: "Shopee authorization cannot be completed now." }); }
    if (!context) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_STATE_INVALID", message: "Shopee authorization state is invalid or expired." });
    const current = await this.config();
    if (context.environment !== current.environment || context.redirectUri !== current.redirectUri) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_STATE_INVALID", message: "Shopee authorization state is invalid or expired." });
    const shopId = input.shopId.trim(); const numericShopId = safeInteger(shopId); const numericPartnerId = safeInteger(current.partnerId);
    let response: ShopeeResponse<TokenResponse>;
    try { const resolved = this.providerConfigs ? await this.providerConfigs.resolveRuntime(true) : loadShopeeRuntimeConfig(); const client = this.clientFactory?.() ?? new ShopeeHttpClient(resolved); response = await client.requestPublic({ operation: "SHOPEE_TOKEN_EXCHANGE", apiPath: "/api/v2/auth/token/get", method: "POST", body: { code: input.code, partner_id: numericPartnerId, shop_id: numericShopId } }); }
    catch { throw new BadRequestException({ errorCode: "SHOPEE_TOKEN_EXCHANGE_FAILED", message: "Shopee authorization could not be completed." }); }
    const token = response.response;
    if (response.error || !token?.access_token || !token.refresh_token || typeof token.expire_in !== "number" || !Number.isFinite(token.expire_in) || token.expire_in <= 0) throw new BadRequestException({ errorCode: "SHOPEE_TOKEN_RESPONSE_INVALID", message: "Shopee authorization could not be completed." });
    const expireIn = token.expire_in; const now = this.clock(); const accessTokenExpiresAt = new Date(now + expireIn * 1000).toISOString(); const envelope = this.credentialService.encryptCredential({ accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: accessTokenExpiresAt, refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_LIFETIME_MS).toISOString(), providerMetadata: { shopId, credentialSource: "OAUTH", refreshOwnership: "ECOMKIT", accessTokenExpiresAt, liveApiStatus: "NOT_TESTED" } });
    const connection = await prisma.marketplaceConnection.upsert({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: shopId } }, create: { platform: Platform.SHOPEE, externalShopId: shopId, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: envelope, createdByUserId: context.initiatingUserId }, update: { credentialEnvelope: envelope, status: MarketplaceConnectionStatus.ACTIVE }, select: { id: true, externalShopId: true } }).catch((error: unknown) => { throw new ConflictException({ errorCode: "SHOPEE_CONNECTION_PERSIST_FAILED", message: "Shopee authorization could not be completed." }, { cause: error as Error }); });
    return { connectionId: connection.id, platform: "SHOPEE", externalShopId: connection.externalShopId, status: "ACTIVE", ...(response.request_id ? { requestId: response.request_id } : {}) };
  }
}
