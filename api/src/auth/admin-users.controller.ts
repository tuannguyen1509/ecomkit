import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import { UserRole } from "@ecomkit/database";
import { RateLimit, Roles } from "./auth.decorators.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { AdminUsersService } from "./admin-users.service.js";
import { CreateAdminUserDto, ResetAdminUserPasswordDto, UpdateAdminUserDto, UserIdParamDto } from "./admin-users.dto.js";

@Controller("admin/users")
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(@Inject(AdminUsersService) private readonly users: AdminUsersService) {}

  @Get()
  list() { return this.users.list(); }

  @Post()
  @RateLimit({ scope: "admin-create-user", limit: 10, windowMs: 60_000 })
  @HttpCode(201)
  create(@Body() body: CreateAdminUserDto) { return this.users.create(body); }

  @Patch(":userId")
  update(@Req() request: AuthenticatedRequest, @Param() params: UserIdParamDto, @Body() body: UpdateAdminUserDto) {
    return this.users.update(request.authUser!.id, params.userId, body);
  }

  @Post(":userId/reset-password")
  @RateLimit({ scope: "admin-reset-password", limit: 10, windowMs: 60_000 })
  @HttpCode(200)
  resetPassword(@Param() params: UserIdParamDto, @Body() body: ResetAdminUserPasswordDto) {
    return this.users.resetPassword(params.userId, body);
  }
}
