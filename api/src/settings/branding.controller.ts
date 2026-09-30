import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UserRole } from "@ecomkit/database";
import type { Response } from "express";
import { Public, RateLimit, Roles } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { UpdateBrandingDto } from "./branding.dto.js";
import { BrandingService } from "./branding.service.js";

@Controller("branding")
export class BrandingPublicController {
  constructor(
    @Inject(BrandingService) private readonly service: BrandingService,
  ) {}
  @Get() @Public() get() {
    return this.service.get();
  }
  @Get("logo") @Public() async logo(
    @Res({ passthrough: true }) response: Response,
  ) {
    const logo = await this.service.logo();
    response.setHeader("Content-Type", logo.mime);
    response.setHeader("Cache-Control", "public, max-age=300");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return new StreamableFile(logo.stream);
  }
}

@Controller("admin/settings/branding")
@Roles(UserRole.ADMIN)
export class BrandingAdminController {
  constructor(
    @Inject(BrandingService) private readonly service: BrandingService,
  ) {}
  @Get() get() {
    return this.service.get();
  }
  @Put()
  @RateLimit({ scope: "admin-branding-update", limit: 20, windowMs: 60_000 })
  update(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateBrandingDto,
  ) {
    return this.service.update(request.authUser!.id, body);
  }
  @Post("logo")
  @HttpCode(200)
  @RateLimit({ scope: "admin-branding-logo", limit: 10, windowMs: 60_000 })
  @UseInterceptors(
    FileInterceptor("logo", {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.upload(request.authUser!.id, file);
  }
}
