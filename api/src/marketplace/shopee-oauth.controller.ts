import { Controller, Get, HttpException, Inject, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { UserRole } from "@ecomkit/database";
import { Public, Roles } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { ShopeeOAuthService } from "./shopee-oauth.service.js";

@Controller("marketplaces/shopee/oauth")
export class ShopeeOAuthController {
  constructor(@Inject(ShopeeOAuthService) private readonly oauth: ShopeeOAuthService) {}
  @Post("start") @Roles(UserRole.ADMIN)
  start(@Req() request: AuthenticatedRequest) { return this.oauth.start(request.authUser!.id); }
  @Get("callback") @Public()
  async callback(@Res() response: Response, @Query("code") code?: string, @Query("shop_id") shopId?: string, @Query("state") state?: string, @Query("main_account_id") mainAccountId?: string) {
    const target = new URL("/marketplaces", process.env.WEB_ORIGIN ?? "http://localhost:3000");
    try { await this.oauth.callback({ code, shopId, state, mainAccountId }); target.searchParams.set("shopeeOAuth", "success"); return response.redirect(target.toString()); }
    catch (error) { const body = error instanceof HttpException ? error.getResponse() : undefined; const codeValue = typeof body === "object" && body && "errorCode" in body ? String((body as { errorCode: unknown }).errorCode) : "SHOPEE_OAUTH_FAILED"; target.searchParams.set("shopeeOAuth", "failed"); target.searchParams.set("code", codeValue); return response.redirect(target.toString()); }
  }
}
