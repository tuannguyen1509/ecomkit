import { Module } from "@nestjs/common";
import {
  BrandingAdminController,
  BrandingPublicController,
} from "./branding.controller.js";
import { BrandingService } from "./branding.service.js";
@Module({
  controllers: [BrandingPublicController, BrandingAdminController],
  providers: [BrandingService],
})
export class SettingsModule {}
