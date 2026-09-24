console.log("Ecomkit Worker started");

const shutdown = (signal: string): void => {
  console.log(`Ecomkit Worker stopping (${signal})`);
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
