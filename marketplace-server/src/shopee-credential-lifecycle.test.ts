import {
  type Clock,
  type DistributedLockProvider,
  type MarketplaceCredentialCrypto,
  type MarketplaceLifecycleConnection,
  type MarketplaceLifecycleConnectionRepository,
  MarketplaceLifecycleError,
  type ShopeeCredential,
  type ShopeeTokenRefreshClient,
} from "./lifecycle-contracts.js";
import { ShopeeCredentialLifecycle } from "./shopee-credential-lifecycle.js";

const now = new Date("2026-09-28T00:00:00.000Z");
const secretMarkers = ["TEST_ACCESS_TOKEN_SECRET", "TEST_REFRESH_TOKEN_SECRET", "TEST_PARTNER_KEY_SECRET", "TEST_ENVELOPE_SECRET"];
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const expectError = async (run: () => Promise<unknown>, code: string, retryable?: boolean): Promise<MarketplaceLifecycleError> => {
  try { await run(); } catch (error) {
    assert(error instanceof MarketplaceLifecycleError, "expected lifecycle error");
    assert(error.code === code, `expected ${code}, received ${error.code}`);
    if (retryable !== undefined) assert(error.retryable === retryable, "unexpected retryability");
    return error;
  }
  throw new Error(`expected ${code}`);
};
const credential = (overrides: Partial<ShopeeCredential> = {}): ShopeeCredential => ({
  accessToken: "TEST_ACCESS_TOKEN_SECRET", refreshToken: "TEST_REFRESH_TOKEN_SECRET",
  tokenExpiresAt: new Date(now.valueOf() + 3_600_000).toISOString(),
  refreshTokenExpiresAt: new Date(now.valueOf() + 30 * 86_400_000).toISOString(),
  providerMetadata: { shopId: "123" }, ...overrides,
});
const connection = (overrides: Partial<MarketplaceLifecycleConnection> = {}): MarketplaceLifecycleConnection => ({
  connectionId: "connection-1", platform: "SHOPEE", externalShopId: "123", status: "ACTIVE", credentialEnvelope: "TEST_ENVELOPE_SECRET", ...overrides,
});
class FakeRepository implements MarketplaceLifecycleConnectionRepository {
  public reads = 0; public writes = 0; public reauths = 0; public failWrite = false;
  public readonly envelopes: string[] = [];
  public afterFirstRead?: MarketplaceLifecycleConnection;
  public constructor(public current: MarketplaceLifecycleConnection) {}
  async getById(): Promise<MarketplaceLifecycleConnection | null> { this.reads++; return this.reads > 1 && this.afterFirstRead ? this.afterFirstRead : this.current; }
  async replaceCredentialEnvelope(input: Readonly<{ connectionId: string; credentialEnvelope: string }>): Promise<void> { if (this.failWrite) throw new Error("persistence failed"); this.writes++; this.envelopes.push(input.credentialEnvelope); this.current = { ...this.current, credentialEnvelope: input.credentialEnvelope }; }
  async markReauthRequired(): Promise<void> { this.reauths++; this.current = { ...this.current, status: "REAUTH_REQUIRED" }; }
}
class FakeCrypto implements MarketplaceCredentialCrypto {
  public readonly encrypted: ShopeeCredential[] = [];
  public constructor(private readonly values: Map<string, ShopeeCredential>) {}
  encrypt(value: ShopeeCredential): string { this.encrypted.push(value); const key = `envelope-${this.encrypted.length}`; this.values.set(key, value); return key; }
  decrypt(envelope: string): ShopeeCredential { const result = this.values.get(envelope); if (!result) throw new Error("invalid envelope"); return result; }
}
class FakeLock implements DistributedLockProvider {
  public acquires = 0; public releases = 0; public key?: string; public ttl?: number;
  public constructor(private readonly result: "acquired" | "busy" | "unavailable" = "acquired") {}
  async acquire(key: string, ttlMs: number) { this.acquires++; this.key = key; this.ttl = ttlMs; if (this.result !== "acquired") return { kind: this.result } as const; return { kind: "acquired" as const, key, release: async () => { this.releases++; } }; }
}
class FakeRefresh implements ShopeeTokenRefreshClient {
  public calls: Array<{ shopId: string; refreshToken: string }> = [];
  public constructor(public next: Awaited<ReturnType<ShopeeTokenRefreshClient["refreshShopToken"]>> | Error = { accessToken: "ACCESS_B", refreshToken: "REFRESH_B", expireIn: 14_400, requestId: "request-1" }) {}
  async refreshShopToken(input: Readonly<{ shopId: string; refreshToken: string }>) { this.calls.push({ ...input }); if (this.next instanceof Error) throw this.next; return this.next; }
}
class FakeClock implements Clock { public constructor(public current = now) {} now(): Date { return this.current; } }
const create = (initial = credential(), lockKind: "acquired" | "busy" | "unavailable" = "acquired") => {
  const values = new Map<string, ShopeeCredential>([["TEST_ENVELOPE_SECRET", initial]]);
  const repo = new FakeRepository(connection()); const crypto = new FakeCrypto(values); const lock = new FakeLock(lockKind); const refresh = new FakeRefresh(); const clock = new FakeClock();
  const lifecycle = new ShopeeCredentialLifecycle(repo, crypto, lock, refresh, clock, { refreshSkewSeconds: 300, refreshLockTtlMs: 30_000 });
  return { repo, crypto, lock, refresh, clock, lifecycle, values };
};

{
  const { lifecycle, lock, refresh, repo } = create(); const result = await lifecycle.ensureValidAccessToken("connection-1");
  assert(result.accessToken === "TEST_ACCESS_TOKEN_SECRET" && lock.acquires === 0 && refresh.calls.length === 0 && repo.writes === 0, "valid token parity");
}
{
  const { lifecycle, crypto, lock, refresh, repo } = create(credential({ tokenExpiresAt: new Date(now.valueOf() + 300_000).toISOString() })); const result = await lifecycle.ensureValidAccessToken("connection-1");
  assert(result.accessToken === "ACCESS_B" && lock.acquires === 1 && lock.releases === 1 && refresh.calls.length === 1 && repo.writes === 1, "near expiry refresh parity");
  assert(crypto.encrypted[0]?.refreshToken === "REFRESH_B", "rotation persists new refresh token");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() })); await setup.lifecycle.ensureValidAccessToken("connection-1");
  setup.clock.current = new Date(now.valueOf() + 14_401_000); setup.refresh.next = { accessToken: "ACCESS_C", refreshToken: "REFRESH_C", expireIn: 14_400 };
  await setup.lifecycle.ensureValidAccessToken("connection-1"); assert(setup.refresh.calls[1]?.refreshToken === "REFRESH_B", "second refresh uses rotated token");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString(), refreshTokenExpiresAt: now.toISOString() })); await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_REAUTH_REQUIRED", false); assert(setup.refresh.calls.length === 0 && setup.repo.reauths === 1, "expired refresh parity");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() }), "unavailable"); await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_REFRESH_LOCK_UNAVAILABLE", true); assert(setup.refresh.calls.length === 0 && setup.repo.writes === 0 && setup.repo.current.status === "ACTIVE", "lock unavailable parity");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() }), "busy"); await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_REFRESH_LOCK_BUSY", true); assert(setup.refresh.calls.length === 0 && setup.lock.acquires === 1, "bounded busy parity");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() })); setup.repo.afterFirstRead = connection({ credentialEnvelope: "fresh" }); setup.values.set("fresh", credential({ accessToken: "ACCESS_ALREADY_REFRESHED" })); const result = await setup.lifecycle.ensureValidAccessToken("connection-1"); assert(result.accessToken === "ACCESS_ALREADY_REFRESHED" && setup.refresh.calls.length === 0, "post-lock recheck parity");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() })); setup.refresh.next = new Error(`network ${secretMarkers.join(" ")}`); const error = await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_REFRESH_FAILED", true); assert(setup.repo.writes === 0 && setup.repo.current.status === "ACTIVE" && setup.lock.releases === 1, "transient failure parity"); for (const marker of secretMarkers) assert(!JSON.stringify(error).includes(marker) && !error.message.includes(marker), "secret leaked from lifecycle error");
}
for (const next of [{ refreshToken: "REFRESH_B", expireIn: 10 }, { accessToken: "ACCESS_B", expireIn: 10 }, { accessToken: "ACCESS_B", refreshToken: "REFRESH_B", expireIn: 0 }]) {
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() })); setup.refresh.next = next; await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_REFRESH_RESPONSE_INVALID", false); assert(setup.repo.writes === 0 && setup.lock.releases === 1, "invalid response parity");
}
for (const invalid of [connection({ status: "DISABLED" }), connection({ status: "PENDING_AUTH" }), connection({ status: "REAUTH_REQUIRED" }), connection({ platform: "LAZADA" }), connection({ externalShopId: "999" })]) {
  const setup = create(); setup.repo.current = invalid; const error = await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), invalid.platform === "LAZADA" ? "SHOPEE_CONNECTION_PLATFORM_INVALID" : invalid.externalShopId === "999" ? "SHOPEE_CREDENTIAL_SHOP_MISMATCH" : invalid.status === "REAUTH_REQUIRED" ? "SHOPEE_REAUTH_REQUIRED" : "SHOPEE_CONNECTION_NOT_ACTIVE", false); assert(setup.lock.acquires === 0 && setup.refresh.calls.length === 0 && !JSON.stringify(error).includes("TEST_"), "invalid state parity");
}
{
  const setup = create(credential({ tokenExpiresAt: new Date(now.valueOf() - 1).toISOString() })); setup.repo.failWrite = true; await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_CREDENTIAL_PERSIST_FAILED", true); assert(setup.lock.releases === 1, "persistence failure releases lock");
}
{
  const setup = create(); setup.repo.current = connection({ credentialEnvelope: null }); await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "SHOPEE_REAUTH_REQUIRED", false); assert(setup.repo.reauths === 1 && setup.lock.acquires === 0, "invalid encrypted credential requires reconnect");

{
  const external = credential({ refreshToken: undefined, refreshTokenExpiresAt: undefined, providerMetadata: { shopId: "123", credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL" } });
  const setup = create(external); const result = await setup.lifecycle.ensureValidAccessToken("connection-1");
  assert(result.accessToken === "TEST_ACCESS_TOKEN_SECRET" && setup.refresh.calls.length === 0 && setup.lock.acquires === 0, "valid external token is read-only");
}
{
  const external = credential({ refreshToken: undefined, refreshTokenExpiresAt: undefined, tokenExpiresAt: new Date(now.valueOf() + 120_000).toISOString(), providerMetadata: { shopId: "123", credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL" } });
  const setup = create(external); await expectError(() => setup.lifecycle.ensureValidAccessToken("connection-1"), "EXTERNAL_ACCESS_TOKEN_EXPIRED", false);
  assert(setup.refresh.calls.length === 0 && setup.lock.acquires === 0 && setup.repo.writes === 0, "external token never refreshes");
}
}
console.log("Shopee credential lifecycle core parity tests passed");
