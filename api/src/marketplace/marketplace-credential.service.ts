import { Injectable } from "@nestjs/common";
import {
  decryptMarketplaceCredential,
  encryptMarketplaceCredential,
  redactMarketplaceCredential
} from "@ecomkit/shared";
import type { MarketplaceShopCredential, RedactedMarketplaceShopCredential } from "@ecomkit/shared";

@Injectable()
export class MarketplaceCredentialService {
  encryptCredential(credential: MarketplaceShopCredential): string {
    return encryptMarketplaceCredential(credential, process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY);
  }

  decryptCredential(envelope: string): MarketplaceShopCredential {
    return decryptMarketplaceCredential(envelope, process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY);
  }

  redact(credential: MarketplaceShopCredential): RedactedMarketplaceShopCredential {
    return redactMarketplaceCredential(credential);
  }

  hasCredential(envelope: string | null | undefined): boolean {
    return Boolean(envelope);
  }
}
