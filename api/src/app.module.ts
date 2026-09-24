import { Controller, Get, Module } from "@nestjs/common";

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

@Module({ controllers: [HealthController] })
export class AppModule {}
