import {
  createLazadaCommonParameters,
  lazadaTimestamp,
  type LazadaClock,
  type LazadaParameters
} from "./lazada-signature.js";
import { LazadaHttpError } from "./lazada-errors.js";

export const LAZADA_VIETNAM_API_BASE_URL = "https://api.lazada.vn/rest" as const;
export const LAZADA_TOKEN_API_BASE_URL = "https://auth.lazada.com/rest" as const;
export const LAZADA_AUTHORIZATION_URL = "https://auth.lazada.com/oauth/authorize" as const;

export type LazadaApiTarget = "VIETNAM" | "TOKEN";
export type LazadaHttpMethod = "GET" | "POST";
export type LazadaResponseEnvelope<T = unknown> = Readonly<{
  code?: string | number;
  message?: string;
  request_id?: string;
  data?: T;
  detail?: unknown;
}>;
export type LazadaTransportRequest = Readonly<{
  url: string;
  method: LazadaHttpMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  signal: AbortSignal;
}>;
export type LazadaTransportResponse = Readonly<{ status: number; body: string }>;
export interface LazadaTransport { send(request: LazadaTransportRequest): Promise<LazadaTransportResponse>; }

export class FetchLazadaTransport implements LazadaTransport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(request: LazadaTransportRequest): Promise<LazadaTransportResponse> {
    const response = await this.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal
    });
    return { status: response.status, body: await response.text() };
  }
}

export type LazadaHttpClientConfig = Readonly<{
  appKey: string;
  appSecret: string;
  timeoutMs: number;
}>;

export type LazadaLowLevelRequest = Readonly<{
  operation: string;
  target: LazadaApiTarget;
  apiPath: string;
  method: LazadaHttpMethod;
  params?: LazadaParameters;
  accessToken?: string;
  body?: string;
  contentType?: string;
}>;

export function getLazadaApiBaseUrl(target: LazadaApiTarget): string {
  return target === "TOKEN" ? LAZADA_TOKEN_API_BASE_URL : LAZADA_VIETNAM_API_BASE_URL;
}

function safeProviderMessage(message: unknown, secrets: readonly string[]): string | undefined {
  if (typeof message !== "string" || !message.trim()) return undefined;
  let safe = message.slice(0, 500);
  for (const secret of secrets) if (secret) safe = safe.split(secret).join("[REDACTED]");
  return safe;
}

function requestId(envelope: LazadaResponseEnvelope): string | undefined {
  return typeof envelope.request_id === "string" && envelope.request_id ? envelope.request_id : undefined;
}

function providerCode(envelope: LazadaResponseEnvelope): string | undefined {
  if (typeof envelope.code !== "string" && typeof envelope.code !== "number") return undefined;
  return String(envelope.code);
}

function sensitiveParameterValues(params: LazadaParameters | undefined): string[] {
  if (!params) return [];
  return Object.entries(params)
    .filter(([key, value]) => /(?:token|secret|code|sign)/i.test(key) && value !== undefined && value !== "")
    .map(([, value]) => String(value));
}

export class LazadaHttpClientCore {
  constructor(
    private readonly config: LazadaHttpClientConfig,
    private readonly transport: LazadaTransport = new FetchLazadaTransport(),
    private readonly clock: LazadaClock = Date.now
  ) {}

  async request<T = unknown>(input: LazadaLowLevelRequest): Promise<Readonly<{ data: T; requestId?: string }>> {
    this.validateConfig(input);
    const timestamp = lazadaTimestamp(this.clock);
    const signed = createLazadaCommonParameters({
      appKey: this.config.appKey,
      appSecret: this.config.appSecret,
      apiPath: input.apiPath,
      timestamp,
      ...(input.accessToken ? { accessToken: input.accessToken } : {}),
      ...(input.params ? { params: input.params } : {}),
      ...(input.body !== undefined ? { body: input.body } : {})
    });
    const url = new URL(`${getLazadaApiBaseUrl(input.target)}${input.apiPath}`);
    for (const [key, value] of Object.entries(signed)) url.searchParams.set(key, value);
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    let response: LazadaTransportResponse;
    try {
      response = await this.transport.send({
        url: url.toString(),
        method: input.method,
        ...(input.body !== undefined ? {
          body: input.body,
          headers: { "content-type": input.contentType ?? "application/json" }
        } : {}),
        signal
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new LazadaHttpError({
        provider: "LAZADA",
        code: timedOut ? "LAZADA_HTTP_TIMEOUT" : "LAZADA_NETWORK_ERROR",
        operation: input.operation,
        apiPath: input.apiPath,
        retryable: true,
        message: timedOut ? "Lazada request timed out." : "Lazada network request failed."
      });
    }

    let envelope: LazadaResponseEnvelope<T>;
    try {
      envelope = JSON.parse(response.body) as LazadaResponseEnvelope<T>;
    } catch {
      throw new LazadaHttpError({
        provider: "LAZADA",
        code: "LAZADA_RESPONSE_INVALID",
        operation: input.operation,
        apiPath: input.apiPath,
        retryable: response.status >= 500,
        message: "Lazada returned invalid JSON.",
        httpStatus: response.status
      });
    }

    const externalCode = providerCode(envelope);
    const providerMessage = safeProviderMessage(envelope.message, [
      this.config.appSecret,
      input.accessToken ?? "",
      signed.sign,
      ...sensitiveParameterValues(input.params)
    ]);
    if (response.status < 200 || response.status >= 300 || externalCode !== "0") {
      throw new LazadaHttpError({
        provider: "LAZADA",
        code: response.status >= 500 ? "LAZADA_PROVIDER_UNAVAILABLE" : "LAZADA_PROVIDER_ERROR",
        operation: input.operation,
        apiPath: input.apiPath,
        retryable: response.status >= 500,
        message: response.status >= 500 ? "Lazada service is temporarily unavailable." : "Lazada rejected the request.",
        ...(externalCode ? { providerCode: externalCode } : {}),
        ...(providerMessage ? { providerMessage } : {}),
        ...(requestId(envelope) ? { requestId: requestId(envelope) } : {}),
        httpStatus: response.status
      });
    }
    return { data: envelope.data as T, ...(requestId(envelope) ? { requestId: requestId(envelope) } : {}) };
  }

  private validateConfig(input: LazadaLowLevelRequest): void {
    if (!this.config.appKey || !this.config.appSecret || !Number.isInteger(this.config.timeoutMs) || this.config.timeoutMs <= 0 ||
        !input.operation || !input.apiPath.startsWith("/") || input.apiPath.includes("?") || input.apiPath.includes("#")) {
      throw new LazadaHttpError({
        provider: "LAZADA",
        code: "LAZADA_CONFIG_INVALID",
        operation: input.operation || "UNKNOWN",
        apiPath: input.apiPath || "/",
        retryable: false,
        message: "Lazada request configuration is invalid."
      });
    }
  }
}
