import mongoose from "mongoose";
import app from "./app";
import config from "./config";
import logger from "./utils/logger";

async function bootstrap(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info("MongoDB connected", { uri: config.mongoUri });

    app.listen(config.port, () => {
      logger.info(`🚀 Reconciliation Engine running`, {
        port: config.port,
        docs: `http://localhost:${config.port}/api-docs`,
        health: `http://localhost:${config.port}/health`,
      });
      logger.info("Active matching config", {
        timestampTolerance: `±${config.matching.timestampToleranceSeconds}s`,
        quantityTolerance: `±${config.matching.quantityTolerancePct * 100}%`,
        conflictWindow: `${config.matching.conflictWindowSeconds}s`,
      });
    });
  } catch (err) {
    logger.error("Failed to start server", { error: err });
    process.exit(1);
  }
}

bootstrap();
