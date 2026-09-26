import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedRequest } from "./auth.guard.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    if (!request.authUser || !MUTATING_METHODS.has(request.method)) return true;
    const origin = request.headers.origin;
    const trustedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    // Non-browser operational clients do not send Origin. Browser mutation requests must be same trusted origin.
    if (origin && origin !== trustedOrigin) {
      throw new ForbiddenException({ errorCode: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed." });
    }
    return true;
  }
}
