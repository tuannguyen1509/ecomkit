import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from "@nestjs/common";
import { UserRole } from "@ecomkit/database";
import { RateLimit, Roles } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { ImportLazadaExternalTokenDto, ImportShopeeExternalTokenDto, TestLazadaExternalDto, TestShopeeExternalConfigDto, TestShopeeLiveReadDto, UpdateLazadaProviderConfigDto, UpdateShopeeProviderConfigDto } from "./marketplace-provider-config.dto.js";
import { MarketplaceProviderConfigService } from "./marketplace-provider-config.service.js";
import { ShopeeOrderClient } from "./shopee-order.client.js";
import { LazadaAdminService } from "./lazada-admin.service.js";

@Controller("admin/marketplaces/providers") @Roles(UserRole.ADMIN)
export class MarketplaceProviderConfigController {
  constructor(@Inject(MarketplaceProviderConfigService) private readonly configs: MarketplaceProviderConfigService, @Inject(ShopeeOrderClient) private readonly orders: ShopeeOrderClient, @Inject(LazadaAdminService) private readonly lazada: LazadaAdminService) {}
  @Get() list() { return this.configs.list(); }
  @Get("shopee") getShopee() { return this.configs.overview(); }
  @Put("shopee") @RateLimit({ scope: "admin-marketplace-config", limit: 20, windowMs: 60_000 }) update(@Req() request: AuthenticatedRequest, @Body() body: UpdateShopeeProviderConfigDto) { return this.configs.updateShopee(request.authUser!.id, body); }
  @Post("shopee/test") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-config-test", limit: 20, windowMs: 60_000 }) test() { return this.configs.testShopee(); }
  @Post("shopee/external-token") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-token-import", limit: 10, windowMs: 60_000 }) importToken(@Req() request: AuthenticatedRequest, @Body() body: ImportShopeeExternalTokenDto) { return this.configs.importExternalToken(request.authUser!.id, body); }
  @Post("shopee/external-test") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-config-test", limit: 20, windowMs: 60_000 }) testExternal(@Body() body: TestShopeeExternalConfigDto) { return this.configs.testExternalReadOnly(body.connectionId); }
  @Post("shopee/live-test") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-live-test", limit: 5, windowMs: 60_000 }) async liveTest(@Body() body: TestShopeeLiveReadDto) {
    try { await this.configs.assertShopeeConnectionReady(body.connectionId); const page = await this.orders.listOrders(body.connectionId, { timeRangeField: body.timeRangeField, timeFrom: body.timeFrom, timeTo: body.timeTo, pageSize: body.pageSize ?? 10, ...(body.orderStatus ? { orderStatus: body.orderStatus as never } : {}) }); await this.configs.recordLiveTest(body.connectionId, "PASS"); return { status: "PASS", mode: "READ_ONLY", orderCount: page.orders.length, more: page.more, nextCursorPresent: Boolean(page.nextCursor), orderSns: page.orders.map((order) => order.order_sn) }; }
    catch (error) { await this.configs.recordLiveTest(body.connectionId, "FAIL").catch(() => undefined); throw error; }
  }
  @Get("lazada") getLazada() { return this.lazada.overview(); }
  @Put("lazada") @RateLimit({ scope: "admin-marketplace-config", limit: 20, windowMs: 60_000 }) updateLazada(@Req() request: AuthenticatedRequest, @Body() body: UpdateLazadaProviderConfigDto) { return this.lazada.updateConfig(request.authUser!.id, body); }
  @Post("lazada/test") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-config-test", limit: 20, windowMs: 60_000 }) testLazada(@Body() body: TestLazadaExternalDto) { return this.lazada.structuralTest(body.connectionId); }
  @Post("lazada/external-token") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-token-import", limit: 10, windowMs: 60_000 }) importLazadaToken(@Req() request: AuthenticatedRequest, @Body() body: ImportLazadaExternalTokenDto) { return this.lazada.saveExternal(request.authUser!.id, body); }
  @Post("lazada/live-test") @HttpCode(200) @RateLimit({ scope: "admin-marketplace-live-test", limit: 5, windowMs: 60_000 }) testLazadaLive(@Body() body: TestLazadaExternalDto) { return this.lazada.liveTest(body.connectionId); }
}
