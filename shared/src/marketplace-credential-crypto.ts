import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const MARKETPLACE_CREDENTIAL_ENVELOPE_VERSION = 1 as const;
const ALGORITHM = "AES-256-GCM" as const;
const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

export type MarketplaceCredentialErrorCode =
  | "MARKETPLACE_ENCRYPTION_KEY_MISSING"
  | "MARKETPLACE_ENCRYPTION_KEY_INVALID"
  | "MARKETPLACE_CREDENTIAL_ENVELOPE_INVALID"
  | "MARKETPLACE_CREDENTIAL_ENVELOPE_UNSUPPORTED_VERSION"
  | "MARKETPLACE_CREDENTIAL_DECRYPT_FAILED";

export class MarketplaceCredentialCryptoError extends Error {
  constructor(public readonly code: MarketplaceCredentialErrorCode) {
    super(code);
    this.name = "MarketplaceCredentialCryptoError";
  }
}

export type MarketplaceShopCredential = {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  authorizationExpiresAt?: string;
  scopes?: string[];
  providerMetadata?: Record<string, unknown>;
};

export type MarketplaceCredentialEnvelope = {
  version: typeof MARKETPLACE_CREDENTIAL_ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  iv: string;
  ciphertext: string;
  authTag: string;
};

export type RedactedMarketplaceShopCredential = {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  authorizationExpiresAt?: string;
  scopeCount: number;
  providerMetadataKeys: string[];
};

const invalidEnvelope = (): MarketplaceCredentialCryptoError =>
  new MarketplaceCredentialCryptoError("MARKETPLACE_CREDENTIAL_ENVELOPE_INVALID");

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw invalidEnvelope();
  }

  return Buffer.from(value, "base64");
}

function getEncryptionKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey?.trim()) {
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_ENCRYPTION_KEY_MISSING");
  }

  const value = encodedKey.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_ENCRYPTION_KEY_INVALID");
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_ENCRYPTION_KEY_INVALID");
  }

  return key;
}

function parseEnvelope(serializedEnvelope: string): MarketplaceCredentialEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedEnvelope);
  } catch {
    throw invalidEnvelope();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidEnvelope();
  }

  const envelope = parsed as Partial<MarketplaceCredentialEnvelope>;
  if (envelope.version !== MARKETPLACE_CREDENTIAL_ENVELOPE_VERSION) {
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_CREDENTIAL_ENVELOPE_UNSUPPORTED_VERSION");
  }
  if (envelope.algorithm !== ALGORITHM || typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string" || typeof envelope.authTag !== "string") {
    throw invalidEnvelope();
  }

  return envelope as MarketplaceCredentialEnvelope;
}

function parseCredentialPayload(value: string): MarketplaceShopCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_CREDENTIAL_DECRYPT_FAILED");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_CREDENTIAL_DECRYPT_FAILED");
  }

  return parsed as MarketplaceShopCredential;
}

export function encryptMarketplaceCredential(
  credential: MarketplaceShopCredential,
  encodedKey: string | undefined
): string {
  const key = getEncryptionKey(encodedKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(credential), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const envelope: MarketplaceCredentialEnvelope = {
    version: MARKETPLACE_CREDENTIAL_ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };

  return JSON.stringify(envelope);
}

export function decryptMarketplaceCredential(
  serializedEnvelope: string,
  encodedKey: string | undefined
): MarketplaceShopCredential {
  const key = getEncryptionKey(encodedKey);
  const envelope = parseEnvelope(serializedEnvelope);

  try {
    const iv = decodeBase64(envelope.iv);
    const ciphertext = decodeBase64(envelope.ciphertext);
    const authTag = decodeBase64(envelope.authTag);
    if (iv.length !== IV_LENGTH_BYTES || ciphertext.length === 0 || authTag.length !== 16) {
      throw invalidEnvelope();
    }

    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return parseCredentialPayload(plaintext);
  } catch (error) {
    if (error instanceof MarketplaceCredentialCryptoError) {
      throw error;
    }
    throw new MarketplaceCredentialCryptoError("MARKETPLACE_CREDENTIAL_DECRYPT_FAILED");
  }
}

export function redactMarketplaceCredential(credential: MarketplaceShopCredential): RedactedMarketplaceShopCredential {
  return {
    hasAccessToken: Boolean(credential.accessToken),
    hasRefreshToken: Boolean(credential.refreshToken),
    ...(credential.tokenExpiresAt ? { tokenExpiresAt: credential.tokenExpiresAt } : {}),
    ...(credential.refreshTokenExpiresAt ? { refreshTokenExpiresAt: credential.refreshTokenExpiresAt } : {}),
    ...(credential.authorizationExpiresAt ? { authorizationExpiresAt: credential.authorizationExpiresAt } : {}),
    scopeCount: credential.scopes?.length ?? 0,
    providerMetadataKeys: Object.keys(credential.providerMetadata ?? {}).sort()
  };
}
