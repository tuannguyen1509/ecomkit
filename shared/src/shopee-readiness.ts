import type { ShopeeEnvironment } from "./shopee-http-client.js";

export type ShopeeOperationalReadiness = Readonly<{
  environment: ShopeeEnvironment | null;
  environmentConfigured: boolean;
  environmentValid: boolean;
  partnerIdPresent: boolean;
  partnerKeyPresent: boolean;
  callbackConfigured: boolean;
  callbackValid: boolean;
  encryptionKeyValid: boolean;
  redisAvailable: boolean;
  currentServerUtc: string;
  currentUnixSeconds: number;
  readyForOAuth: boolean;
}>;

function validEncryptionKey(value: string | undefined): boolean {
  const candidate = value?.trim();
  if (!candidate || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate) || candidate.length % 4 !== 0) return false;
  return Buffer.from(candidate, "base64").length === 32;
}

function validCallback(value: string | undefined, environment: ShopeeEnvironment | null): boolean {
  if (!value?.trim() || !environment) return false;
  try {
    const url = new URL(value.trim());
    return Boolean(url.hostname) && (environment !== "production" || url.protocol === "https:");
  } catch { return false; }
}

/** Internal-only, secret-free readiness snapshot. It performs no network request. */
export function inspectShopeeOperationalReadiness(
  env: Record<string, string | undefined> = process.env,
  input: Readonly<{ redisAvailable?: boolean; now?: Date }> = {},
): ShopeeOperationalReadiness {
  const configuredMode = env.SHOPEE_ENV?.trim();
  const environment = configuredMode === undefined || configuredMode === "" ? "sandbox" : configuredMode === "sandbox" || configuredMode === "production" ? configuredMode : null;
  const environmentConfigured = Boolean(configuredMode);
  const environmentValid = environment !== null;
  const partnerIdPresent = Boolean(env.SHOPEE_PARTNER_ID?.trim());
  const partnerKeyPresent = Boolean(env.SHOPEE_PARTNER_KEY);
  const callbackConfigured = Boolean(env.SHOPEE_REDIRECT_URI?.trim());
  const callbackValid = validCallback(env.SHOPEE_REDIRECT_URI, environment);
  const encryptionKeyValid = validEncryptionKey(env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY);
  const redisAvailable = input.redisAvailable === true;
  const now = input.now ?? new Date();
  const currentUnixSeconds = Math.floor(now.valueOf() / 1000);
  return {
    environment, environmentConfigured, environmentValid, partnerIdPresent, partnerKeyPresent, callbackConfigured, callbackValid,
    encryptionKeyValid, redisAvailable, currentServerUtc: now.toISOString(), currentUnixSeconds,
    readyForOAuth: environmentValid && partnerIdPresent && partnerKeyPresent && callbackValid && encryptionKeyValid && redisAvailable,
  };
}
