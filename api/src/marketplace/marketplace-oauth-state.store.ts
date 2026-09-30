import { createHash } from "node:crypto";
import { OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

export type MarketplaceOAuthPlatform = "SHOPEE" | "LAZADA";
export type MarketplaceOAuthStateContext = Readonly<{ platform: MarketplaceOAuthPlatform }>;

export class MarketplaceOAuthStateStore<TContext extends MarketplaceOAuthStateContext> implements OnModuleDestroy {
  private client?: Redis;
  constructor(private readonly platform: TContext["platform"]) {}
  private key(state: string): string { return `${this.platform.toLowerCase()}-oauth-state-${createHash("sha256").update(state).digest("hex")}`; }
  private redis(): Redis { return this.client ??= new Redis({ host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379"), maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true }); }
  async save(state: string, context: TContext, ttlSeconds: number): Promise<void> {
    if (context.platform !== this.platform) throw new Error("MARKETPLACE_OAUTH_STATE_PLATFORM_MISMATCH");
    const client = this.redis(); if (client.status === "wait") await client.connect();
    const stored = await client.set(this.key(state), JSON.stringify(context), "EX", ttlSeconds, "NX");
    if (stored !== "OK") throw new Error("MARKETPLACE_OAUTH_STATE_STORE_FAILED");
  }
  async consume(state: string): Promise<TContext | null> {
    const client = this.redis(); if (client.status === "wait") await client.connect();
    const value = await client.eval("local value=redis.call('GET',KEYS[1]); if value then redis.call('DEL',KEYS[1]); end; return value", 1, this.key(state));
    if (typeof value !== "string") return null;
    try { const parsed = JSON.parse(value) as TContext; return parsed.platform === this.platform ? parsed : null; } catch { return null; }
  }
  async onModuleDestroy(): Promise<void> { await this.client?.quit().catch(() => undefined); }
}
