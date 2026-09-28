import { createHash } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

export type ShopeeOAuthStateContext = { platform: "SHOPEE"; initiatingUserId: string; environment: "sandbox" | "production"; redirectUri: string; createdAt: string };

@Injectable()
export class ShopeeOAuthStateStore implements OnModuleDestroy {
  private client?: Redis;
  private key(state: string): string { return `shopee-oauth-state-${createHash("sha256").update(state).digest("hex")}`; }
  private redis(): Redis { return this.client ??= new Redis({ host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379"), maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true }); }
  async save(state: string, context: ShopeeOAuthStateContext, ttlSeconds: number): Promise<void> {
    const client = this.redis(); if (client.status === "wait") await client.connect();
    const stored = await client.set(this.key(state), JSON.stringify(context), "EX", ttlSeconds, "NX");
    if (stored !== "OK") throw new Error("SHOPEE_OAUTH_STATE_STORE_FAILED");
  }
  async consume(state: string): Promise<ShopeeOAuthStateContext | null> {
    const client = this.redis(); if (client.status === "wait") await client.connect();
    const value = await client.eval("local value=redis.call('GET',KEYS[1]); if value then redis.call('DEL',KEYS[1]); end; return value", 1, this.key(state));
    if (typeof value !== "string") return null;
    try { const parsed = JSON.parse(value) as ShopeeOAuthStateContext; return parsed.platform === "SHOPEE" ? parsed : null; } catch { return null; }
  }
  async onModuleDestroy(): Promise<void> { await this.client?.quit().catch(() => undefined); }
}
