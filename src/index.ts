import { startServer } from "./server.js";
import { logger } from "./logger.js";

startServer().catch((err) => {
  logger.fatal({ err }, "server failed to start");
  process.exit(1);
});
