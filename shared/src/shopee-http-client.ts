import { createHmac } from "node:crypto";

export type ShopeeEnvironment = "sandbox" | "production";
export type ShopeeRuntimeConfig = { environment: ShopeeEnvironment; partnerId: string; partnerKey: string; timeoutMs: number };
export type ShopeeClock = () => number;
export type ShopeeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ShopeeResponse<T = unknown> = { request_id?: string; error?: string; message?: string; response?: T };

export class ShopeeConfigError extends Error {
  constructor(public readonly code: "SHOPEE_CONFIG_MISSING" | "SHOPEE_ENV_INVALID") { super(code); this.name = "ShopeeConfigError"; }
}

export class ShopeeHttpError extends Error {
  constructor(
    public readonly safe: { operation: string; apiPath: string; httpStatus?: number; requestId?: string; externalCode?: string; retryableHint: boolean; safeMessage: string }
  ) { super(safe.safeMessage); this.name = "ShopeeHttpError"; }

  toJSON(): object { return { name: this.name, ...this.safe }; }
}

const baseUrls: Record<ShopeeEnvironment, string> = {
  production: "https://partner.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg"
};

export function loadShopeeRuntimeConfig(env: Record<string, string | undefined> = process.env): ShopeeRuntimeConfig {
  const partnerId = env.SHOPEE_PARTNER_ID?.trim();
  const partnerKey = env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) throw new ShopeeConfigError("SHOPEE_CONFIG_MISSING");
  const environment = env.SHOPEE_ENV ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") throw new ShopeeConfigError("SHOPEE_ENV_INVALID");
  return { environment, partnerId, partnerKey, timeoutMs: Number(env.SHOPEE_HTTP_TIMEOUT_MS ?? "30000") };
}

export function getShopeeBaseUrl(environment: ShopeeEnvironment): string { return baseUrls[environment]; }
export function hmacSha256Hex(key: string | Buffer, value: string): string { return createHmac("sha256", key).update(value, "utf8").digest("hex"); }

export class ShopeeSigner {
  constructor(private readonly partnerId: string, private readonly partnerKey: string) {}
  publicBaseString(apiPath: string, timestamp: number): string { return `${this.partnerId}${apiPath}${timestamp}`; }
  shopBaseString(apiPath: string, timestamp: number, accessToken: string, shopId: string | number): string { return `${this.partnerId}${apiPath}${timestamp}${accessToken}${shopId}`; }
  signPublic(apiPath: string, timestamp: number): string { return hmacSha256Hex(this.partnerKey, this.publicBaseString(apiPath, timestamp)); }
  signShop(apiPath: string, timestamp: number, accessToken: string, shopId: string | number): string { return hmacSha256Hex(this.partnerKey, this.shopBaseString(apiPath, timestamp, accessToken, shopId)); }
}

type BaseRequest = { operation: string; apiPath: string; method?: "GET" | "POST"; query?: Record<string, string | number | boolean | undefined>; body?: unknown };
export type ShopeePublicRequest = BaseRequest;
export type ShopeeShopRequest = BaseRequest & { accessToken: string; shopId: string | number };

export class ShopeeHttpClient {
  private readonly signer: ShopeeSigner;
  constructor(private readonly config: ShopeeRuntimeConfig, private readonly fetchImpl: ShopeeFetch = fetch, private readonly clock: ShopeeClock = () => Math.floor(Date.now() / 1000)) {
    this.signer = new ShopeeSigner(config.partnerId, config.partnerKey);
  }

  async requestPublic<T = unknown>(request: ShopeePublicRequest): Promise<ShopeeResponse<T>> {
    const timestamp = this.timestamp();
    return this.execute<T>(request, { partner_id: this.config.partnerId, timestamp, sign: this.signer.signPublic(request.apiPath, timestamp) });
  }

  async requestShop<T = unknown>(request: ShopeeShopRequest): Promise<ShopeeResponse<T>> {
    const timestamp = this.timestamp();
    return this.execute<T>(request, {
      partner_id: this.config.partnerId,
      timestamp,
      access_token: request.accessToken,
      shop_id: request.shopId,
      sign: this.signer.signShop(request.apiPath, timestamp, request.accessToken, request.shopId)
    });
  }

  private timestamp(): number { return Math.floor(this.clock()); }
  private async execute<T>(request: BaseRequest, signingQuery: Record<string, string | number>): Promise<ShopeeResponse<T>> {
    const url = new URL(request.apiPath, getShopeeBaseUrl(this.config.environment));
    const query = { ...request.query, ...signingQuery };
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: request.method ?? "GET",
        headers: request.body === undefined ? undefined : { "content-type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new ShopeeHttpError({ operation: request.operation, apiPath: request.apiPath, retryableHint: true, safeMessage: timedOut ? "Shopee request timed out." : "Shopee network request failed." });
    }
    const text = await response.text();
    let envelope: ShopeeResponse<T>;
    try { envelope = JSON.parse(text) as ShopeeResponse<T>; } catch {
      throw new ShopeeHttpError({ operation: request.operation, apiPath: request.apiPath, httpStatus: response.status, retryableHint: response.status >= 500, safeMessage: "Shopee returned invalid JSON." });
    }
    if (!response.ok) {
      throw new ShopeeHttpError({ operation: request.operation, apiPath: request.apiPath, httpStatus: response.status, requestId: envelope.request_id, externalCode: envelope.error, retryableHint: response.status >= 500, safeMessage: "Shopee request failed." });
    }
    return envelope;
  }
}
