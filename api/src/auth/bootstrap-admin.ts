import { prisma } from "@ecomkit/database";
import { AuthService } from "./auth.service.js";

const authService = new AuthService();

void authService
  .bootstrapFirstAdmin()
  .then((created) => console.log(created ? "Bootstrap ADMIN created." : "Admin already exists."))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unable to bootstrap ADMIN.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
