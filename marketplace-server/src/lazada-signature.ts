import { createHmac } from "node:crypto";

export type LazadaParameterValue = string | number | boolean | undefined;
export type LazadaParameters = Readonly<Record<string, LazadaParameterValue>>;
export type LazadaClock = () => number;

export const LAZADA_SIGN_METHOD = "sha256" as const;

export class LazadaSigningError extends Error {
  readonly retryable = false;

  constructor(public readonly code: "LAZADA_SIGNING_INPUT_INVALID") {
    super(code);
    this.name = "LazadaSigningError";
  }

  toJSON(): object { return { name: this.name, code: this.code, retryable: false }; }
}

function requireApiPath(apiPath: string): void {
  if (!apiPath.startsWith("/") || apiPath.includes("?") || apiPath.includes("#")) {
    throw new LazadaSigningError("LAZADA_SIGNING_INPUT_INVALID");
  }
}

export function normalizeLazadaSigningParameters(params: LazadaParameters): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "sign" || value === undefined || value === "") continue;
    if (!key || (typeof value === "number" && !Number.isFinite(value))) {
      throw new LazadaSigningError("LAZADA_SIGNING_INPUT_INVALID");
    }
    normalized[key] = String(value);
  }
  return normalized;
}

export function buildLazadaSignatureBase(apiPath: string, params: LazadaParameters, body?: string): string {
  requireApiPath(apiPath);
  if (body !== undefined && typeof body !== "string") throw new LazadaSigningError("LAZADA_SIGNING_INPUT_INVALID");
  const normalized = normalizeLazadaSigningParameters(params);
  const parameterText = Object.keys(normalized)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((key) => `${key}${normalized[key]}`)
    .join("");
  return `${apiPath}${parameterText}${body ?? ""}`;
}

export function signLazadaRequest(input: Readonly<{ apiPath: string; params: LazadaParameters; body?: string; appSecret: string }>): string {
  if (!input.appSecret) throw new LazadaSigningError("LAZADA_SIGNING_INPUT_INVALID");
  return createHmac("sha256", input.appSecret)
    .update(buildLazadaSignatureBase(input.apiPath, input.params, input.body), "utf8")
    .digest("hex")
    .toUpperCase();
}

export function lazadaTimestamp(clock: LazadaClock = Date.now): string {
  const milliseconds = clock();
  if (!Number.isFinite(milliseconds)) throw new LazadaSigningError("LAZADA_SIGNING_INPUT_INVALID");
  return String(Math.trunc(milliseconds));
}

export function createLazadaCommonParameters(input: Readonly<{
  appKey: string;
  apiPath: string;
  appSecret: string;
  timestamp: string;
  accessToken?: string;
  params?: LazadaParameters;
  body?: string;
}>): Readonly<Record<string, string>> {
  if (!input.appKey || !/^\d+$/.test(input.timestamp)) throw new LazadaSigningError("LAZADA_SIGNING_INPUT_INVALID");
  const unsigned = normalizeLazadaSigningParameters({
    ...input.params,
    app_key: input.appKey,
    timestamp: input.timestamp,
    sign_method: LAZADA_SIGN_METHOD,
    ...(input.accessToken ? { access_token: input.accessToken } : {})
  });
  return {
    ...unsigned,
    sign: signLazadaRequest({ apiPath: input.apiPath, params: unsigned, body: input.body, appSecret: input.appSecret })
  };
}
