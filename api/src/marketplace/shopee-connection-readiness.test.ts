import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { MarketplaceConnectionStatus } from "@ecomkit/database";
import { MarketplaceProviderConfigController } from "./marketplace-provider-config.controller.js";
import { deriveShopeeCredentialReadiness } from "./marketplace-provider-config.service.js";

const now = Date.UTC(2026, 9, 1);
const row = (status: MarketplaceConnectionStatus = MarketplaceConnectionStatus.ACTIVE, envelope: string | null = "encrypted") => ({ externalShopId: "123456", status, credentialEnvelope: envelope });
const oauth = (overrides: Record<string, unknown> = {}) => ({ accessToken: "ACCESS", refreshToken: "REFRESH", tokenExpiresAt: new Date(now + 60_000).toISOString(), refreshTokenExpiresAt: new Date(now + 86_400_000).toISOString(), providerMetadata: { shopId: "123456", credentialSource: "OAUTH", refreshOwnership: "ECOMKIT" }, ...overrides });
const external = (overrides: Record<string, unknown> = {}) => ({ accessToken: "ACCESS", tokenExpiresAt: new Date(now + 60_000).toISOString(), providerMetadata: { shopId: "123456", credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL" }, ...overrides });

assert.equal(deriveShopeeCredentialReadiness(row(MarketplaceConnectionStatus.ACTIVE, null), undefined, false, now).credentialReady, false, "ACTIVE without envelope must not connect");
assert.equal(deriveShopeeCredentialReadiness(row(), undefined, true, now).credentialState, "INCOMPLETE", "decrypt failure must be safe and incomplete");
assert.equal(deriveShopeeCredentialReadiness(row(), oauth({ refreshToken: undefined }), false, now).credentialReady, false, "OAuth access-only credential must not connect");
assert.deepEqual(deriveShopeeCredentialReadiness(row(), oauth(), false, now), { credentialSource: "OAUTH", refreshOwnership: "ECOMKIT", credentialEnvelopePresent: true, credentialDecryptable: true, accessTokenPresent: true, refreshTokenPresent: true, accessExpiresAt: new Date(now + 60_000).toISOString(), refreshExpiresAt: new Date(now + 86_400_000).toISOString(), credentialReady: true, credentialState: "CONNECTED" });
assert.equal(deriveShopeeCredentialReadiness(row(), external(), false, now).credentialState, "EXTERNAL_READY");
assert.equal(deriveShopeeCredentialReadiness(row(MarketplaceConnectionStatus.PENDING_AUTH), oauth(), false, now).credentialReady, false);
assert.equal(deriveShopeeCredentialReadiness(row(), oauth({ tokenExpiresAt: new Date(now - 1).toISOString() }), false, now).credentialState, "TOKEN_EXPIRED", "expired OAuth access token remains structurally refreshable");
assert.equal(deriveShopeeCredentialReadiness(row(), external({ tokenExpiresAt: new Date(now - 1).toISOString() }), false, now).credentialReady, false, "expired external token is not ready");

let providerCalls = 0;
const localError = new BadRequestException({ errorCode: "SHOPEE_CONNECTION_CREDENTIALS_INCOMPLETE" });
const controller = new MarketplaceProviderConfigController({ assertShopeeConnectionReady: async () => { throw localError; }, recordLiveTest: async () => undefined } as never, { listOrders: async () => { providerCalls++; return { orders: [], more: false }; } } as never, {} as never);
await assert.rejects(() => controller.liveTest({ connectionId: "incomplete", timeRangeField: "create_time", timeFrom: 1, timeTo: 2, pageSize: 1 }), (error) => error === localError);
assert.equal(providerCalls, 0, "incomplete credential must be rejected before provider transport");
assert.ok(!JSON.stringify(localError).includes("SHOPEE_ORDER_PROVIDER_TRANSIENT"));

console.log("Shopee credential readiness tests passed");
