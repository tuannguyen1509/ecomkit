import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@ecomkit/database";

export const IS_PUBLIC_KEY = "ecomkit:is-public";
export const ALLOW_INTERNAL_WORKER_KEY = "ecomkit:allow-internal-worker";
export const ROLES_KEY = "ecomkit:roles";
export const RATE_LIMIT_KEY = "ecomkit:rate-limit";

export type RateLimitOptions = { scope: string; limit: number; windowMs: number };

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
export const AllowInternalWorker = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_INTERNAL_WORKER_KEY, true);
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_KEY, options);
