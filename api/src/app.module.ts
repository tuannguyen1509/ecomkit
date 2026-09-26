import { Controller, Get, Module } from "@nestjs/common";
import { BatchesModule } from "./batches/batches.module.js";
import { FilesModule } from "./files/files.module.js";
import { ExcelModule } from "./excel/excel.module.js";
import { PdfModule } from "./pdf/pdf.module.js";
import { MatchingModule } from "./matching/matching.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { Public } from "./auth/auth.decorators.js";
import { MarketplaceModule } from "./marketplace/marketplace.module.js";

@Controller("health")
@Public()
class HealthController {
  @Get()
  health(): { status: "ok"; service: "ecomkit-api"; timestamp: string } {
    return {
      status: "ok",
      service: "ecomkit-api",
      timestamp: new Date().toISOString()
    };
  }
}

@Module({
  imports: [AuthModule, BatchesModule, FilesModule, ExcelModule, PdfModule, MatchingModule, QueueModule, MarketplaceModule],
  controllers: [HealthController]
})
export class AppModule {}
