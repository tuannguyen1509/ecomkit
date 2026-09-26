import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { RolesGuard } from "./roles.guard.js";
import { AdminUsersController } from "./admin-users.controller.js";
import { AdminUsersService } from "./admin-users.service.js";
import { OriginGuard } from "./origin.guard.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

@Module({
  controllers: [AuthController, AdminUsersController],
  providers: [
    AuthService, AdminUsersService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard }
  ],
  exports: [AuthService]
})
export class AuthModule {}
