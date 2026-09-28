import { Controller, Get, Post, Query, Req } from "@nestjs/common";
import { UserRole } from "@ecomkit/database";
import { Public, Roles } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { ShopeeOAuthService } from "./shopee-oauth.service.js";

@Controller("marketplaces/shopee/oauth")
export class ShopeeOAuthController {
  constructor(private readonly oauth: ShopeeOAuthService) {}
  @Post("start") @Roles(UserRole.ADMIN)
  start(@Req() request: AuthenticatedRequest) { return this.oauth.start(request.authUser!.id); }
  @Get("callback") @Public()
  callback(@Query("code") code?: string, @Query("shop_id") shopId?: string, @Query("state") state?: string, @Query("main_account_id") mainAccountId?: string) { return this.oauth.callback({ code, shopId, state, mainAccountId }); }
}
