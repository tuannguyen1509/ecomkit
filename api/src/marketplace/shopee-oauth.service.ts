import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { loadShopeeRuntimeConfig, ShopeeHttpClient } from "@ecomkit/shared";
import type { ShopeeEnvironment, ShopeeResponse } from "@ecomkit/shared";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";
import { ShopeeOAuthStateStore, type ShopeeOAuthStateContext } from "./shopee-oauth-state.store.js";

type TokenResponse = { access_token?: string; refresh_token?: string; expire_in?: number };
type TokenClient = { requestPublic(request: { operation: string; apiPath: string; method: "POST"; body: unknown }): Promise<ShopeeResponse<TokenResponse>> };
type OAuthConfig = { environment: ShopeeEnvironment; partnerId: string; redirectUri: string; ttlSeconds: number };
const authHosts: Record<ShopeeEnvironment, string> = { production: "https://open.shopee.com", sandbox: "https://open.sandbox.test-stable.shopee.com" };

function config(): OAuthConfig {
  const runtime = loadShopeeRuntimeConfig(); const redirectUri = process.env.SHOPEE_REDIRECT_URI?.trim();
  if (!redirectUri) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." });
  let url: URL; try { url = new URL(redirectUri); } catch { throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." }); }
  if (runtime.environment === "production" && url.protocol !== "https:") throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." });
  const ttlSeconds = Number(process.env.SHOPEE_OAUTH_STATE_TTL_SECONDS ?? "600");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CONFIG_MISSING", message: "Shopee OAuth configuration is unavailable." });
  return { environment: runtime.environment, partnerId: runtime.partnerId, redirectUri: url.toString(), ttlSeconds };
}

@Injectable()
export class ShopeeOAuthService {
  constructor(private readonly credentialService: MarketplaceCredentialService, private readonly states: ShopeeOAuthStateStore, private readonly clientFactory: () => TokenClient = () => new ShopeeHttpClient(loadShopeeRuntimeConfig())) {}
  async start(initiatingUserId: string): Promise<{ authorizationUrl: string; expiresIn: number }> {
    const current = config(); const state = randomBytes(32).toString("base64url");
    const context: ShopeeOAuthStateContext = { platform: "SHOPEE", initiatingUserId, environment: current.environment, redirectUri: current.redirectUri, createdAt: new Date().toISOString() };
    try { await this.states.save(state, context, current.ttlSeconds); } catch { throw new ServiceUnavailableException({ errorCode: "SHOPEE_OAUTH_STATE_STORE_UNAVAILABLE", message: "Shopee authorization cannot be started now." }); }
    const url = new URL("/auth", authHosts[current.environment]);
    url.searchParams.set("partner_id", current.partnerId); url.searchParams.set("auth_type", "seller"); url.searchParams.set("redirect_uri", current.redirectUri); url.searchParams.set("response_type", "code"); url.searchParams.set("state", state);
    return { authorizationUrl: url.toString(), expiresIn: current.ttlSeconds };
  }
  async callback(input: { code?: string; shopId?: string; state?: string; mainAccountId?: string }): Promise<{ connectionId: string; platform: "SHOPEE"; externalShopId: string; status: "ACTIVE"; requestId?: string }> {
    if (!input.shopId && input.mainAccountId) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_MAIN_ACCOUNT_UNSUPPORTED", message: "Main-account authorization is not supported." });
    if (!input.code || !input.shopId || !input.state) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CALLBACK_INVALID", message: "Shopee callback is invalid." });
    let context: ShopeeOAuthStateContext | null; try { context = await this.states.consume(input.state); } catch { throw new ServiceUnavailableException({ errorCode: "SHOPEE_OAUTH_STATE_STORE_UNAVAILABLE", message: "Shopee authorization cannot be completed now." }); }
    if (!context) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_STATE_INVALID", message: "Shopee authorization state is invalid or expired." });
    const current = config();
    if (context.environment !== current.environment || context.redirectUri !== current.redirectUri) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_STATE_INVALID", message: "Shopee authorization state is invalid or expired." });
    const shopId = input.shopId.trim(); if (!/^\d+$/.test(shopId)) throw new BadRequestException({ errorCode: "SHOPEE_OAUTH_CALLBACK_INVALID", message: "Shopee callback is invalid." });
    let response: ShopeeResponse<TokenResponse>;
    try { response = await this.clientFactory().requestPublic({ operation: "SHOPEE_TOKEN_EXCHANGE", apiPath: "/api/v2/auth/token/get", method: "POST", body: { code: input.code, partner_id: Number(current.partnerId), shop_id: Number(shopId) } }); }
    catch { throw new BadRequestException({ errorCode: "SHOPEE_TOKEN_EXCHANGE_FAILED", message: "Shopee authorization could not be completed." }); }
    const token = response.response;
    if (response.error || !token?.access_token || !token.refresh_token || typeof token.expire_in !== "number" || !Number.isFinite(token.expire_in) || token.expire_in <= 0) throw new BadRequestException({ errorCode: "SHOPEE_TOKEN_RESPONSE_INVALID", message: "Shopee authorization could not be completed." });
    const expireIn = token.expire_in; const now = Date.now(); const envelope = this.credentialService.encryptCredential({ accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: new Date(now + expireIn * 1000).toISOString(), refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(), providerMetadata: { shopId } });
    const connection = await prisma.marketplaceConnection.upsert({ where: { platform_externalShopId: { platform: Platform.SHOPEE, externalShopId: shopId } }, create: { platform: Platform.SHOPEE, externalShopId: shopId, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: envelope, createdByUserId: context.initiatingUserId }, update: { credentialEnvelope: envelope, status: MarketplaceConnectionStatus.ACTIVE }, select: { id: true, externalShopId: true } }).catch((error: unknown) => { throw new ConflictException({ errorCode: "SHOPEE_CONNECTION_PERSIST_FAILED", message: "Shopee authorization could not be completed." }, { cause: error as Error }); });
    return { connectionId: connection.id, platform: "SHOPEE", externalShopId: connection.externalShopId, status: "ACTIVE", ...(response.request_id ? { requestId: response.request_id } : {}) };
  }
}
