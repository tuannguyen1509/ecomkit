import { Controller, Get, Module } from "@nestjs/common";
import { BatchesModule } from "./batches/batches.module.js";
import { FilesModule } from "./files/files.module.js";

@Controller("health")
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
  imports: [BatchesModule, FilesModule],
  controllers: [HealthController]
})
export class AppModule {}
