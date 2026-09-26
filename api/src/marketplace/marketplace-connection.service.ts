import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";
import type { MarketplaceConnection, Prisma } from "@ecomkit/database";
import type { MarketplaceShopCredential } from "@ecomkit/shared";
import { MarketplaceCredentialService } from "./marketplace-credential.service.js";

const safeConnectionSelect = {
  id: true,
  platform: true,
  externalShopId: true,
  shopName: true,
  status: true,
  lastSuccessfulSyncAt: true,
  lastAttemptedSyncAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.MarketplaceConnectionSelect;

export type SafeMarketplaceConnection = Prisma.MarketplaceConnectionGetPayload<{
  select: typeof safeConnectionSelect;
}>;

export type CreateMarketplaceConnectionInput = {
  platform: Platform;
  externalShopId: string;
  shopName?: string;
  createdByUserId?: string;
};

const allowedStatusTransitions: Readonly<Record<MarketplaceConnectionStatus, readonly MarketplaceConnectionStatus[]>> = {
  [MarketplaceConnectionStatus.PENDING_AUTH]: [MarketplaceConnectionStatus.ACTIVE, MarketplaceConnectionStatus.DISABLED],
  [MarketplaceConnectionStatus.ACTIVE]: [MarketplaceConnectionStatus.REAUTH_REQUIRED, MarketplaceConnectionStatus.DISABLED],
  [MarketplaceConnectionStatus.REAUTH_REQUIRED]: [MarketplaceConnectionStatus.ACTIVE, MarketplaceConnectionStatus.DISABLED],
  [MarketplaceConnectionStatus.DISABLED]: []
};

@Injectable()
export class MarketplaceConnectionService {
  constructor(private readonly credentialService: MarketplaceCredentialService) {}

  async create(input: CreateMarketplaceConnectionInput): Promise<SafeMarketplaceConnection> {
    if (input.platform === Platform.UNKNOWN) {
      throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_INVALID_PLATFORM", message: "Unsupported marketplace platform." });
    }

    try {
      return await prisma.marketplaceConnection.create({
        data: {
          platform: input.platform,
          externalShopId: input.externalShopId,
          shopName: input.shopName,
          createdByUserId: input.createdByUserId
        },
        select: safeConnectionSelect
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_ALREADY_EXISTS", message: "Marketplace connection already exists." });
      }
      throw error;
    }
  }

  async get(connectionId: string): Promise<SafeMarketplaceConnection> {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: safeConnectionSelect });
    if (!connection) {
      throw this.notFound();
    }
    return connection;
  }

  async attachCredential(connectionId: string, credential: MarketplaceShopCredential): Promise<SafeMarketplaceConnection> {
    await this.requireConnection(connectionId);
    return prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: { credentialEnvelope: this.credentialService.encryptCredential(credential) },
      select: safeConnectionSelect
    });
  }

  async getCredentialForInternalUse(connectionId: string): Promise<MarketplaceShopCredential> {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: { id: connectionId },
      select: { credentialEnvelope: true }
    });
    if (!connection) {
      throw this.notFound();
    }
    if (!connection.credentialEnvelope) {
      throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_CREDENTIAL_MISSING", message: "Marketplace connection credentials are unavailable." });
    }
    return this.credentialService.decryptCredential(connection.credentialEnvelope);
  }

  async transitionStatus(connectionId: string, nextStatus: MarketplaceConnectionStatus): Promise<SafeMarketplaceConnection> {
    const current = await this.requireConnection(connectionId);
    if (!allowedStatusTransitions[current.status].includes(nextStatus)) {
      throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_INVALID_STATE", message: "Marketplace connection state transition is not allowed." });
    }
    return prisma.marketplaceConnection.update({ where: { id: connectionId }, data: { status: nextStatus }, select: safeConnectionSelect });
  }

  async disable(connectionId: string): Promise<SafeMarketplaceConnection> {
    const current = await this.requireConnection(connectionId);
    if (current.status === MarketplaceConnectionStatus.DISABLED) {
      return current;
    }
    return this.transitionStatus(connectionId, MarketplaceConnectionStatus.DISABLED);
  }

  async clearCredentialForReauthorization(connectionId: string): Promise<SafeMarketplaceConnection> {
    const current = await this.requireConnection(connectionId);
    if (current.status === MarketplaceConnectionStatus.DISABLED) {
      throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_INVALID_STATE", message: "Disabled marketplace connections cannot be reauthorized." });
    }
    return prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: { credentialEnvelope: null, status: MarketplaceConnectionStatus.REAUTH_REQUIRED },
      select: safeConnectionSelect
    });
  }

  private async requireConnection(connectionId: string): Promise<MarketplaceConnection> {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!connection) {
      throw this.notFound();
    }
    return connection;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ errorCode: "MARKETPLACE_CONNECTION_NOT_FOUND", message: "Marketplace connection was not found." });
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
  }
}
