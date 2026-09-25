import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@ecomkit/database";
import { ROLES_KEY } from "./auth.decorators.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authUser) throw new UnauthorizedException({ errorCode: "AUTH_REQUIRED", message: "Authentication required." });
    if (!roles.includes(request.authUser.role)) throw new ForbiddenException({ errorCode: "AUTH_ROLE_FORBIDDEN", message: "Insufficient role." });
    return true;
  }
}
