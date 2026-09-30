import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { decryptMarketplaceCredential } from "@ecomkit/shared";
import { LazadaHttpClientCore, type LazadaTransport, type LazadaTransportRequest, type LazadaTransportResponse } from "./lazada-http-client-core.js";
import {
  encryptLazadaAcquisitionCredential,
  LazadaOAuthCore,
  LazadaOAuthError,
  LazadaTokenCreateClient,
  type LazadaOAuthStateContext,
  type LazadaOAuthStateStore,
  type LazadaTokenEnvelope
} from "./lazada-oauth-core.js";

const appKey = "123456";
const appSecret = "TEST_LAZADA_APP_SECRET";
const authCode = "TEST_LAZADA_AUTH_CODE";
const accessToken = "TEST_LAZADA_ACCESS_TOKEN";
const refreshToken = "TEST_LAZADA_REFRESH_TOKEN";
const encryptionMarker = "TEST_MARKETPLACE_ENCRYPTION_SECRET";
const redirectUri = "http://localhost:3001/api/marketplaces/lazada/oauth/callback";
const now = Date.parse("2026-09-30T00:00:00.000Z");

type Stored = { context: LazadaOAuthStateContext; expiresAt: number };
class MemoryStateStore implements LazadaOAuthStateStore {
  readonly values = new Map<string, Stored>();
  constructor(private readonly clock: () => number) {}
  async save(state: string, context: LazadaOAuthStateContext, ttlSeconds: number): Promise<void> { this.values.set(state, { context, expiresAt: this.clock() + ttlSeconds * 1000 }); }
  async consume(state: string): Promise<LazadaOAuthStateContext | null> {
    const stored = this.values.get(state); this.values.delete(state);
    return stored && stored.expiresAt > this.clock() ? stored.context : null;
  }
}

class FakeTransport implements LazadaTransport {
  readonly requests: LazadaTransportRequest[] = [];
  constructor(public response: LazadaTransportResponse | Error) {}
  async send(request: LazadaTransportRequest): Promise<LazadaTransportResponse> { this.requests.push(request); if (this.response instanceof Error) throw this.response; return this.response; }
}

function tokenEnvelope(entries: unknown[] = [{ country: "vn", user_id: "USER_VN", seller_id: "SELLER_VN", short_code: "VNTEST" }]): LazadaTokenEnvelope {
  return { code: "0", request_id: "request-token", access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, refresh_expires_in: 7200, country: "vn", account: "synthetic@example.invalid", account_platform: "seller_center", country_user_info: entries };
}

function setup(envelope: LazadaTokenEnvelope | Error = tokenEnvelope(), stateValue = "SYNTHETIC_STATE") {
  const transport = new FakeTransport(envelope instanceof Error ? envelope : { status: 200, body: JSON.stringify(envelope) });
  const http = new LazadaHttpClientCore({ appKey, appSecret, timeoutMs: 1000 }, transport, () => now);
  const states = new MemoryStateStore(() => now);
  const oauth = new LazadaOAuthCore({ appKey, redirectUri, stateTtlSeconds: 600 }, states, new LazadaTokenCreateClient(http), () => now, () => stateValue);
  return { oauth, states, transport };
}

async function expectCode(action: () => Promise<unknown>, code: string, retryable?: boolean): Promise<LazadaOAuthError> {
  try { await action(); }
  catch (error) {
    assert.ok(error instanceof LazadaOAuthError);
    assert.equal(error.code, code);
    if (retryable !== undefined) assert.equal(error.retryable, retryable);
    return error;
  }
  throw new Error(`Expected ${code}`);
}

function assertSecretSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of [appSecret, authCode, accessToken, refreshToken, encryptionMarker]) assert.equal(serialized.includes(secret), false, `secret leaked: ${secret}`);
}

async function run(): Promise<void> {
  const basic = setup();
  const start = await basic.oauth.start("admin-1");
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin, "https://auth.lazada.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("force_auth"), "true");
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.get("client_id"), appKey);
  assert.equal(url.searchParams.get("state"), "SYNTHETIC_STATE");
  assert.equal(start.expiresIn, 600);
  assert.equal(start.authorizationUrl.includes(appSecret), false);

  const acquired = await basic.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" });
  assert.equal(acquired.externalShopId, "vn:SELLER_VN");
  assert.equal(acquired.safeResult.country, "vn");
  assert.equal(acquired.safeResult.sellerId, "SELLER_VN");
  assert.equal(acquired.safeResult.userId, "USER_VN");
  assert.equal(acquired.safeResult.accessExpiresAt, "2026-09-30T01:00:00.000Z");
  assert.equal(acquired.safeResult.refreshExpiresAt, "2026-09-30T02:00:00.000Z");
  assert.equal(acquired.credential.accessToken, accessToken);
  assert.equal(acquired.credential.refreshToken, refreshToken);
  assert.equal(JSON.stringify(acquired.safeResult).includes(accessToken), false);
  assert.equal(JSON.stringify(acquired.safeResult).includes(refreshToken), false);
  assert.equal(basic.transport.requests.length, 1);
  const tokenRequest = basic.transport.requests[0]!;
  const tokenUrl = new URL(tokenRequest.url);
  assert.equal(`${tokenUrl.origin}${tokenUrl.pathname}`, "https://auth.lazada.com/rest/auth/token/create");
  assert.equal(tokenRequest.method, "POST");
  assert.equal(tokenUrl.searchParams.get("code"), authCode);
  assert.equal(tokenUrl.searchParams.has("access_token"), false);
  assert.equal(tokenUrl.searchParams.has("app_secret"), false);
  assert.equal(tokenUrl.searchParams.get("sign_method"), "sha256");
  assert.ok(tokenUrl.searchParams.get("sign"));
  assert.equal(basic.transport.requests.some((request) => request.url.includes("/auth/token/refresh") || request.url.includes("/orders/get") || request.url.includes("/order/")), false);

  const encryptionKey = randomBytes(32).toString("base64");
  const encrypted = encryptLazadaAcquisitionCredential(acquired, encryptionKey);
  assert.equal(encrypted.includes(accessToken), false);
  assert.equal(encrypted.includes(refreshToken), false);
  assert.equal(encrypted.includes(appSecret), false);
  assert.deepEqual(decryptMarketplaceCredential(encrypted, encryptionKey), acquired.credential);
  try { encryptLazadaAcquisitionCredential(acquired, encryptionMarker); throw new Error("invalid encryption key accepted"); }
  catch (error) { assertSecretSafe(error); }

  await expectCode(() => basic.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_OAUTH_STATE_INVALID");
  assert.equal(basic.transport.requests.length, 1, "replay must not call token endpoint");

  const missing = setup();
  await expectCode(() => missing.oauth.callback({ state: "SYNTHETIC_STATE" }), "LAZADA_OAUTH_CALLBACK_INVALID");
  await expectCode(() => missing.oauth.callback({ code: authCode }), "LAZADA_OAUTH_CALLBACK_INVALID");
  assert.equal(missing.transport.requests.length, 0);

  const expired = setup();
  expired.states.values.set("EXPIRED", { context: { platform: "LAZADA", initiatingUserId: "admin", region: "VN", redirectUri, createdAt: new Date(now).toISOString() }, expiresAt: now });
  await expectCode(() => expired.oauth.callback({ code: authCode, state: "EXPIRED" }), "LAZADA_OAUTH_STATE_INVALID");
  assert.equal(expired.transport.requests.length, 0);

  const wrongProvider = setup();
  wrongProvider.states.values.set("WRONG", { context: { platform: "SHOPEE" } as never, expiresAt: now + 1000 });
  await expectCode(() => wrongProvider.oauth.callback({ code: authCode, state: "WRONG" }), "LAZADA_OAUTH_STATE_INVALID");
  assert.equal(wrongProvider.transport.requests.length, 0);

  const multi = setup(tokenEnvelope([{ country: "sg", user_id: "USER_SG", seller_id: "SELLER_SG" }, { country: "VN", user_id: "USER_VN", seller_id: "SELLER_VN" }]));
  await multi.oauth.start("admin");
  assert.equal((await multi.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" })).externalShopId, "vn:SELLER_VN");

  const noVn = setup(tokenEnvelope([{ country: "sg", user_id: "USER_SG", seller_id: "SELLER_SG" }]));
  await noVn.oauth.start("admin");
  await expectCode(() => noVn.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_VIETNAM_STORE_REQUIRED");

  const duplicateVn = setup(tokenEnvelope([{ country: "vn", user_id: "1", seller_id: "1" }, { country: "vn", user_id: "2", seller_id: "2" }]));
  await duplicateVn.oauth.start("admin");
  await expectCode(() => duplicateVn.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_VIETNAM_STORE_AMBIGUOUS");

  const providerFailure = setup({ code: "InvalidCode", message: `invalid ${authCode} ${appSecret}`, request_id: "request-failure" });
  await providerFailure.oauth.start("admin");
  const providerError = await expectCode(() => providerFailure.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_TOKEN_CREATE_FAILED", false);
  assert.equal(providerError.providerCode, "InvalidCode");
  assert.equal(providerError.requestId, "request-failure");
  assertSecretSafe(providerError);

  const network = setup(new Error(`${accessToken} ${refreshToken}`));
  await network.oauth.start("admin");
  assertSecretSafe(await expectCode(() => network.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_TOKEN_CREATE_FAILED", true));
  assert.equal(network.transport.requests.length, 1);

  const timeout = setup(new DOMException(appSecret, "TimeoutError"));
  await timeout.oauth.start("admin");
  assertSecretSafe(await expectCode(() => timeout.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_TOKEN_CREATE_FAILED", true));

  const invalid = setup({ ...tokenEnvelope(), expires_in: "3600" });
  await invalid.oauth.start("admin");
  await expectCode(() => invalid.oauth.callback({ code: authCode, state: "SYNTHETIC_STATE" }), "LAZADA_TOKEN_RESPONSE_INVALID");

  console.log("Lazada OAuth and token acquisition foundation tests passed");
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Lazada OAuth test failed");
  process.exitCode = 1;
});
