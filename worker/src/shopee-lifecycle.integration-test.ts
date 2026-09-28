import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import { MarketplaceLifecycleError, ShopeeCredentialLifecycle } from "@ecomkit/marketplace-server";
import { decryptMarketplaceCredential, encryptMarketplaceCredential } from "@ecomkit/shared";
import { WorkerMarketplaceCredentialCrypto, WorkerMarketplaceLifecycleConnectionRepository, WorkerRedisDistributedLockProvider, createWorkerShopeeCredentialLifecycle } from "./shopee-lifecycle.worker.js";

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const shopId = `90000${Math.floor(Math.random() * 90000 + 10000)}`;
const oldAccess = "TEST_ACCESS_TOKEN_OLD_SECRET", oldRefresh = "TEST_REFRESH_TOKEN_OLD_SECRET", newAccess = "TEST_ACCESS_TOKEN_NEW_SECRET", newRefresh = "TEST_REFRESH_TOKEN_NEW_SECRET";
const key = randomBytes(32).toString("base64");
process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = key;
const now = () => Date.now();
const credential = (overrides: Record<string, unknown> = {}) => ({ accessToken: oldAccess, refreshToken: oldRefresh, tokenExpiresAt: new Date(now() - 1000).toISOString(), refreshTokenExpiresAt: new Date(now() + 86400000).toISOString(), providerMetadata: { shopId }, ...overrides });
const errorCode = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { return error instanceof MarketplaceLifecycleError ? error.code : undefined; } return undefined; };

async function run(): Promise<void> {
  const connection = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: shopId, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: encryptMarketplaceCredential(credential(), key) } });
  let calls = 0, received: string[] = [];
  const refresh = { refreshShopToken: async (input: { shopId: string; refreshToken: string }) => { calls++; received.push(input.refreshToken); return { accessToken: newAccess, refreshToken: newRefresh, expireIn: 14_400 }; } };
  const locks = new WorkerRedisDistributedLockProvider();
  const worker = createWorkerShopeeCredentialLifecycle({ locks, refreshClient: refresh });
  try {
    const first = await worker.lifecycle.ensureValidAccessToken(connection.id);
    assert.equal(first.accessToken, newAccess); assert.equal(calls, 1); assert.equal(received[0], oldRefresh);
    let row = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connection.id } });
    assert.ok(row.credentialEnvelope && !row.credentialEnvelope.includes(newAccess));
    assert.equal(decryptMarketplaceCredential(row.credentialEnvelope!, key).refreshToken, newRefresh);
    await worker.lifecycle.ensureValidAccessToken(connection.id); assert.equal(calls, 1, "valid Worker token must not refresh");

    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { credentialEnvelope: encryptMarketplaceCredential(credential({ accessToken: newAccess, refreshToken: newRefresh, tokenExpiresAt: new Date(now() - 1000).toISOString() }), key) } });
    await worker.lifecycle.ensureValidAccessToken(connection.id); assert.equal(received[1], newRefresh);

    const apiLocks = new WorkerRedisDistributedLockProvider();
    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { credentialEnvelope: encryptMarketplaceCredential(credential(), key) } });
    calls = 0; received = [];
    const apiStyle = new ShopeeCredentialLifecycle(new WorkerMarketplaceLifecycleConnectionRepository(), new WorkerMarketplaceCredentialCrypto(), apiLocks, refresh, { now: () => new Date() }, { refreshSkewSeconds: 300, refreshLockTtlMs: 30_000 });
    const [fromApiStyle, fromWorker] = await Promise.all([apiStyle.ensureValidAccessToken(connection.id), worker.lifecycle.ensureValidAccessToken(connection.id)]);
    assert.equal(calls, 1); assert.equal(fromApiStyle.accessToken, newAccess); assert.equal(fromWorker.accessToken, newAccess);
    await apiLocks.dispose();

    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { credentialEnvelope: encryptMarketplaceCredential(credential({ refreshTokenExpiresAt: new Date(now() - 1).toISOString() }), key), status: MarketplaceConnectionStatus.ACTIVE } });
    assert.equal(await errorCode(() => worker.lifecycle.ensureValidAccessToken(connection.id)), "SHOPEE_REAUTH_REQUIRED"); assert.equal(calls, 1);

    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { credentialEnvelope: encryptMarketplaceCredential(credential(), key), status: MarketplaceConnectionStatus.ACTIVE } });
    const unavailable = createWorkerShopeeCredentialLifecycle({ locks: new WorkerRedisDistributedLockProvider({ host: "redis-unavailable", port: 6379 }), refreshClient: refresh });
    assert.equal(await errorCode(() => unavailable.lifecycle.ensureValidAccessToken(connection.id)), "SHOPEE_REFRESH_LOCK_UNAVAILABLE"); assert.equal(calls, 1); await unavailable.locks.dispose();
    await worker.lifecycle.ensureValidAccessToken(connection.id); assert.equal(calls, 2, "Worker lifecycle must recover with its normal Redis lock");
    console.log("worker Shopee lifecycle and cross-runtime refresh tests passed");
  } finally {
    await locks.dispose(); await prisma.marketplaceConnection.delete({ where: { id: connection.id } }).catch(() => undefined); await prisma.$disconnect();
  }
}
void run().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : "worker Shopee lifecycle test failed"); process.exitCode = 1; });
