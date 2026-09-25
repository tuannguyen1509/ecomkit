import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ALLOW_INTERNAL_WORKER_KEY, IS_PUBLIC_KEY } from "./auth.decorators.js";
import { AuthService, type SafeUser } from "./auth.service.js";
import { isValidInternalWorkerKey, WORKER_KEY_HEADER } from "./internal-worker-auth.js";

export type AuthenticatedRequest = Request & { authUser?: SafeUser; isInternalWorker?: boolean };

function sessionToken(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("ecomkit_session="))
    ?.slice("ecomkit_session=".length);
}

function workerHeader(request: Request): string | undefined {
  const value = request.headers[WORKER_KEY_HEADER];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.authService.getSessionByRawToken(sessionToken(request));
    if (session) {
      request.authUser = session.user;
      return true;
    }

    const permitsWorker = this.reflector.getAllAndOverride<boolean>(ALLOW_INTERNAL_WORKER_KEY, [context.getHandler(), context.getClass()]);
    if (permitsWorker && isValidInternalWorkerKey(workerHeader(request))) {
      request.isInternalWorker = true;
      return true;
    }

    throw new UnauthorizedException({ errorCode: "AUTH_REQUIRED", message: "Authentication required." });
  }
}
