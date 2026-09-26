-- Persist only a versioned encrypted credential envelope. Plaintext marketplace
-- access tokens, refresh tokens, authorization codes, and application secrets
-- must never be stored in this table.
ALTER TABLE "marketplace_connections"
ADD COLUMN "credential_envelope" TEXT;
