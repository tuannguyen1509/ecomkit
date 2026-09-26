import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./auth.decorators.js";

type WindowEntry = { count: number; resetAt: number };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { body?: { username?: unknown } }>();
    const username = typeof request.body?.username === "string" ? request.body.username.trim().toLowerCase() : "";
    const key = `${options.scope}:${request.ip ?? "unknown"}:${username}`;
    const now = Date.now();
    const current = this.entries.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    entry.count += 1;
    this.entries.set(key, entry);
    if (entry.count > options.limit) {
      throw new HttpException({
        errorCode: options.scope === "auth-login" ? "AUTH_RATE_LIMITED" : "RATE_LIMITED",
        message: "Too many requests. Please try again later."
      }, 429);
    }
    return true;
  }
}
