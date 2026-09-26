import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import {
  decryptMarketplaceCredential,
  encryptMarketplaceCredential,
  MarketplaceCredentialCryptoError
} from "@ecomkit/shared";
import type { MarketplaceAdapter } from "./marketplace-adapter.js";
import { MarketplaceAdapterRegistry, MarketplaceAdapterRegistryError } from "./marketplace-adapter.registry.js";
import { MarketplaceConnectionService } from "./marketplace-connection.service.js";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";

const marker = "TEST_ACCESS_TOKEN_DO_NOT_USE";
const originalKey = process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;
const testKey = randomBytes(32).toString("base64");
process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = testKey;

const expectCryptoError = (callback: () => unknown, code: string): void => {
  assert.throws(callback, (error: unknown) => error instanceof MarketplaceCredentialCryptoError && error.code === code);
};

const mockAdapter: MarketplaceAdapter = {
  platform: Platform.SHOPEE,
  async getAuthorizationUrl() { return { authorizationUrl: "https://example.invalid/authorize" }; },
  async exchangeAuthorizationCode() { return { credential: { accessToken: "synthetic" }, connection: { externalShopId: "synthetic-shop" } }; },
  async refreshAccessToken(credential) { return credential; },
  async validateConnection() { return { externalShopId: "synthetic-shop" }; },
  async listOrders() { return { orders: [] }; },
  async getOrderDetail() { return {}; }
};

async function run(): Promise<void> {
  const credential = { accessToken: marker, refreshToken: "TEST_REFRESH_TOKEN_DO_NOT_USE", scopes: ["orders.read"], providerMetadata: { region: "test" } };
  const envelopeA = encryptMarketplaceCredential(credential, testKey);
  const envelopeB = encryptMarketplaceCredential(credential, testKey);
  assert.notEqual(envelopeA, envelopeB, "each encryption must use a fresh IV");
  assert.deepEqual(decryptMarketplaceCredential(envelopeA, testKey), credential);

  const tamperedCiphertext = JSON.parse(envelopeA) as { ciphertext: string; authTag: string; version: number };
  tamperedCiphertext.ciphertext = `${tamperedCiphertext.ciphertext[0] === "A" ? "B" : "A"}${tamperedCiphertext.ciphertext.slice(1)}`;
  expectCryptoError(() => decryptMarketplaceCredential(JSON.stringify(tamperedCiphertext), testKey), "MARKETPLACE_CREDENTIAL_DECRYPT_FAILED");
  const tamperedTag = JSON.parse(envelopeA) as { ciphertext: string; authTag: string; version: number };
  tamperedTag.authTag = `${tamperedTag.authTag[0] === "A" ? "B" : "A"}${tamperedTag.authTag.slice(1)}`;
  expectCryptoError(() => decryptMarketplaceCredential(JSON.stringify(tamperedTag), testKey), "MARKETPLACE_CREDENTIAL_DECRYPT_FAILED");
  expectCryptoError(() => decryptMarketplaceCredential(envelopeA, randomBytes(32).toString("base64")), "MARKETPLACE_CREDENTIAL_DECRYPT_FAILED");
  expectCryptoError(() => decryptMarketplaceCredential("not-json", testKey), "MARKETPLACE_CREDENTIAL_ENVELOPE_INVALID");
  const unsupported = JSON.parse(envelopeA) as { version: number };
  unsupported.version = 999;
  expectCryptoError(() => decryptMarketplaceCredential(JSON.stringify(unsupported), testKey), "MARKETPLACE_CREDENTIAL_ENVELOPE_UNSUPPORTED_VERSION");
  expectCryptoError(() => encryptMarketplaceCredential(credential, undefined), "MARKETPLACE_ENCRYPTION_KEY_MISSING");
  expectCryptoError(() => encryptMarketplaceCredential(credential, Buffer.alloc(31).toString("base64")), "MARKETPLACE_ENCRYPTION_KEY_INVALID");

  const registry = new MarketplaceAdapterRegistry();
  registry.register(mockAdapter);
  assert.equal(registry.resolve(Platform.SHOPEE), mockAdapter);
  assert.throws(() => registry.register(mockAdapter), (error: unknown) => error instanceof MarketplaceAdapterRegistryError && error.code === "MARKETPLACE_ADAPTER_ALREADY_REGISTERED");
  assert.throws(() => registry.resolve(Platform.UNKNOWN), (error: unknown) => error instanceof MarketplaceAdapterRegistryError && error.code === "MARKETPLACE_ADAPTER_NOT_REGISTERED");
  assert.throws(() => registry.resolve(Platform.LAZADA), (error: unknown) => error instanceof MarketplaceAdapterRegistryError && error.code === "MARKETPLACE_ADAPTER_NOT_REGISTERED");

  const credentials = new MarketplaceCredentialService();
  const redacted = credentials.redact(credential);
  assert.equal(JSON.stringify(redacted).includes(marker), false, "redacted credential must not contain access token");
  assert.equal(JSON.stringify(redacted).includes("TEST_REFRESH_TOKEN_DO_NOT_USE"), false, "redacted credential must not contain refresh token");
  assert.equal(redacted.hasAccessToken, true);
  assert.equal(redacted.hasRefreshToken, true);
  const connections = new MarketplaceConnectionService(credentials);
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const externalShopId = `test-shop-${suffix}`;
  let connectionId: string | undefined;

  try {
    const connection = await connections.create({ platform: Platform.SHOPEE, externalShopId, shopName: "Synthetic marketplace shop" });
    connectionId = connection.id;
    assert.equal(connection.status, MarketplaceConnectionStatus.PENDING_AUTH);
    assert.equal("credentialEnvelope" in connection, false, "safe DTO must not expose credential envelope");

    await connections.attachCredential(connection.id, credential);
    const persisted = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connection.id } });
    assert.ok(persisted.credentialEnvelope);
    assert.equal(persisted.credentialEnvelope.includes(marker), false, "plaintext marker must not be stored");
    assert.deepEqual(await connections.getCredentialForInternalUse(connection.id), credential);

    const replacement = { accessToken: "TEST_REPLACEMENT_TOKEN_DO_NOT_USE" };
    await connections.attachCredential(connection.id, replacement);
    assert.deepEqual(await connections.getCredentialForInternalUse(connection.id), replacement);

    const safeConnection = await connections.get(connection.id);
    assert.equal("credentialEnvelope" in safeConnection, false);
    await connections.transitionStatus(connection.id, MarketplaceConnectionStatus.ACTIVE);
    await connections.disable(connection.id);
    assert.equal((await connections.get(connection.id)).status, MarketplaceConnectionStatus.DISABLED);
    await assert.rejects(() => connections.transitionStatus(connection.id, MarketplaceConnectionStatus.ACTIVE));

    await assert.rejects(
      () => connections.create({ platform: Platform.SHOPEE, externalShopId }),
      (error: unknown) => Boolean(error && typeof error === "object" && "response" in error)
    );
  } finally {
    if (connectionId) {
      await prisma.marketplaceConnection.delete({ where: { id: connectionId } });
    }
    if (originalKey === undefined) delete process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY = originalKey;
    await prisma.$disconnect();
  }

  console.log("marketplace core credential tests passed");
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Marketplace core credential test failed");
  process.exitCode = 1;
});
