import { strict as assert } from "node:assert";
import {
  buildLazadaSignatureBase,
  createLazadaCommonParameters,
  LAZADA_SIGN_METHOD,
  lazadaTimestamp,
  signLazadaRequest
} from "./lazada-signature.js";
import { LazadaHttpError } from "./lazada-errors.js";
import {
  getLazadaApiBaseUrl,
  LazadaHttpClientCore,
  LAZADA_TOKEN_API_BASE_URL,
  LAZADA_VIETNAM_API_BASE_URL,
  type LazadaTransport,
  type LazadaTransportRequest,
  type LazadaTransportResponse
} from "./lazada-http-client-core.js";

const appSecret = "TEST_LAZADA_APP_SECRET";
const accessToken = "TEST_LAZADA_ACCESS_TOKEN";
const refreshToken = "TEST_LAZADA_REFRESH_TOKEN";
const appKey = "123456";
const timestamp = 1_517_820_392_000;
const apiPath = "/order/get";

class CapturingTransport implements LazadaTransport {
  readonly requests: LazadaTransportRequest[] = [];
  constructor(private readonly response: LazadaTransportResponse | Error) {}
  async send(request: LazadaTransportRequest): Promise<LazadaTransportResponse> {
    this.requests.push(request);
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

function serialized(error: unknown): string { return JSON.stringify(error); }
function hasNoSecrets(error: unknown): boolean {
  const text = `${error instanceof Error ? error.message : ""}${serialized(error)}`;
  return !text.includes(appSecret) && !text.includes(accessToken) && !text.includes(refreshToken) && !text.includes("sign=");
}

async function expectError(action: () => Promise<unknown>, check: (error: unknown) => boolean): Promise<void> {
  await assert.rejects(action, check);
}

async function run(): Promise<void> {
  const paramsA = { timestamp: String(timestamp), order_id: "1234", app_key: appKey, sign_method: "sha256", access_token: "test" };
  const paramsB = { access_token: "test", app_key: appKey, order_id: "1234", sign_method: "sha256", timestamp: String(timestamp) };
  const officialExpected = "4190D32361CFB9581350222F345CB77F3B19F0E31D162316848A2C1FFD5FAB4A";
  assert.equal(signLazadaRequest({ apiPath, params: paramsA, appSecret: "helloworld" }), officialExpected, "official Lazada signing vector");
  assert.equal(signLazadaRequest({ apiPath, params: paramsA, appSecret }), signLazadaRequest({ apiPath, params: paramsB, appSecret }));
  const signature = signLazadaRequest({ apiPath, params: paramsA, appSecret });
  assert.match(signature, /^[0-9A-F]{64}$/);
  assert.notEqual(signature, signLazadaRequest({ apiPath: "/orders/get", params: paramsA, appSecret }));
  assert.notEqual(signature, signLazadaRequest({ apiPath, params: { ...paramsA, order_id: "1235" }, appSecret }));
  assert.notEqual(signature, signLazadaRequest({ apiPath, params: paramsA, appSecret: `${appSecret}_OTHER` }));
  assert.equal(signLazadaRequest({ apiPath, params: { ...paramsA, sign: "STALE" }, appSecret }), signature);
  assert.deepEqual(paramsA, { timestamp: String(timestamp), order_id: "1234", app_key: appKey, sign_method: "sha256", access_token: "test" });
  assert.equal(buildLazadaSignatureBase(apiPath, { z: "last", empty: "", a: "first", absent: undefined }), `${apiPath}afirstzlast`);

  const body = JSON.stringify({ synthetic: true });
  assert.equal(buildLazadaSignatureBase(apiPath, { app_key: appKey }, body), `${apiPath}app_key${appKey}${body}`);
  assert.equal(lazadaTimestamp(() => timestamp), String(timestamp));
  const common = createLazadaCommonParameters({ appKey, appSecret, apiPath, timestamp: String(timestamp), accessToken, params: { order_id: "1234" } });
  assert.equal(common.app_key, appKey);
  assert.equal(common.timestamp, String(timestamp));
  assert.equal(common.sign_method, LAZADA_SIGN_METHOD);
  assert.equal(common.access_token, accessToken);
  assert.ok(common.sign);
  assert.equal("app_secret" in common, false);
  const publicCommon = createLazadaCommonParameters({ appKey, appSecret, apiPath: "/auth/token/create", timestamp: String(timestamp) });
  assert.equal("access_token" in publicCommon, false);

  assert.equal(getLazadaApiBaseUrl("VIETNAM"), LAZADA_VIETNAM_API_BASE_URL);
  assert.equal(getLazadaApiBaseUrl("TOKEN"), LAZADA_TOKEN_API_BASE_URL);

  const successTransport = new CapturingTransport({ status: 200, body: JSON.stringify({ code: "0", request_id: "request-success", data: { ok: true } }) });
  const client = new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, successTransport, () => timestamp);
  const success = await client.request<{ ok: boolean }>({ operation: "SYNTHETIC_ORDER", target: "VIETNAM", apiPath, method: "POST", accessToken, params: { order_id: "1234" }, body, contentType: "application/json" });
  assert.deepEqual(success.data, { ok: true });
  assert.equal(success.requestId, "request-success");
  assert.equal(success.envelope.code, "0");
  assert.equal(successTransport.requests.length, 1, "no automatic retry");
  const captured = successTransport.requests[0]!;
  const capturedUrl = new URL(captured.url);
  assert.equal(`${capturedUrl.origin}${capturedUrl.pathname}`, `${LAZADA_VIETNAM_API_BASE_URL}${apiPath}`);
  assert.equal(captured.method, "POST");
  assert.equal(captured.body, body, "signed body must equal transmitted body");
  assert.equal(capturedUrl.searchParams.get("access_token"), accessToken);
  const sentSign = capturedUrl.searchParams.get("sign")!;
  const unsignedSent = Object.fromEntries([...capturedUrl.searchParams.entries()].filter(([key]) => key !== "sign"));
  assert.equal(sentSign, signLazadaRequest({ apiPath, params: unsignedSent, body, appSecret }), "signed and transmitted path/params/body must match");

  const tokenTransport = new CapturingTransport({ status: 200, body: JSON.stringify({ code: 0, data: { token: "synthetic" } }) });
  await new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, tokenTransport, () => timestamp)
    .request({ operation: "TOKEN_FOUNDATION", target: "TOKEN", apiPath: "/auth/token/create", method: "POST", params: { code: "SYNTHETIC" } });
  const tokenUrl = new URL(tokenTransport.requests[0]!.url);
  assert.equal(`${tokenUrl.origin}${tokenUrl.pathname}`, `${LAZADA_TOKEN_API_BASE_URL}/auth/token/create`);
  assert.equal(tokenUrl.searchParams.has("access_token"), false);

  const providerError = new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, new CapturingTransport({ status: 200, body: JSON.stringify({ code: "IllegalAccessToken", message: `denied ${accessToken} ${appSecret} ${refreshToken}`, request_id: "request-error" }) }), () => timestamp);
  await expectError(() => providerError.request({ operation: "ERROR", target: "VIETNAM", apiPath, method: "GET", accessToken, params: { refresh_token: refreshToken } }), (error) =>
    error instanceof LazadaHttpError && error.providerCode === "IllegalAccessToken" && error.requestId === "request-error" && !error.retryable && hasNoSecrets(error));

  const unavailable = new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, new CapturingTransport({ status: 503, body: JSON.stringify({ code: "500", message: "backend unavailable", request_id: "request-503" }) }), () => timestamp);
  await expectError(() => unavailable.request({ operation: "HTTP_5XX", target: "VIETNAM", apiPath, method: "GET", accessToken }), (error) =>
    error instanceof LazadaHttpError && error.retryable && error.httpStatus === 503 && error.requestId === "request-503" && hasNoSecrets(error));

  const timeout = new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, new CapturingTransport(new DOMException(`timeout ${accessToken}`, "TimeoutError")), () => timestamp);
  await expectError(() => timeout.request({ operation: "TIMEOUT", target: "VIETNAM", apiPath, method: "GET", accessToken }), (error) =>
    error instanceof LazadaHttpError && error.code === "LAZADA_HTTP_TIMEOUT" && error.retryable && hasNoSecrets(error));

  const networkTransport = new CapturingTransport(new Error(`network ${appSecret} ${refreshToken}`));
  const network = new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, networkTransport, () => timestamp);
  await expectError(() => network.request({ operation: "NETWORK", target: "VIETNAM", apiPath, method: "GET", accessToken }), (error) =>
    error instanceof LazadaHttpError && error.code === "LAZADA_NETWORK_ERROR" && error.retryable && networkTransport.requests.length === 1 && hasNoSecrets(error));

  console.log("Lazada signing and HTTP client foundation tests passed");
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Lazada foundation test failed");
  process.exitCode = 1;
});
