import { Body, Controller, Get, HttpCode, Post, Put, Req } from "@nestjs/common";
import { UserRole } from "@ecomkit/database";
import { RateLimit, Roles } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { UpdateShopeeProviderConfigDto } from "./marketplace-provider-config.dto.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";

@Controller("admin/marketplaces/providers") @Roles(UserRole.ADMIN)
export class MarketplaceProviderConfigController {
  constructor(private readonly configs: MarketplaceProviderConfigService) {}
  @Get() list() { return this.configs.list(); }
  @Get("shopee") getShopee() { return this.configs.overview(); }
  @Put("shopee") @RateLimit({ scope: "admin-marketplace-config", limit: 20, windowMs: 60_000 }) update(@Req() request: AuthenticatedRequest, @Body() body: UpdateShopeeProviderConfigDto) { return this.configs.updateShopee(request.authUser!.id, body); }
  @Post("shopee/test") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-config-test", limit: 20, windowMs: 60_000 }) test() { return this.configs.testShopee(); }
}
