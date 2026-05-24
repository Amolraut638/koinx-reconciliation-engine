/**
 * Seed script — loads sample CSVs and triggers a reconciliation run.
 * Usage: npm run seed
 */
import mongoose from "mongoose";
import config from "../config";
import { runReconciliation } from "../services/reconciliation.service";
import logger from "../utils/logger";

async function seed(): Promise<void> {
  logger.info("🌱 Seed script started");

  await mongoose.connect(config.mongoUri);
  logger.info("MongoDB connected");

  const result = await runReconciliation();

  if (result.status === "completed") {
    logger.info("✅ Seed complete", {
      runId: result.runId,
      summary: result.summary,
      csvReport: result.csvReportPath,
    });
    console.log("\n──────────────────────────────────────");
    console.log("✅ Seed successful!");
    console.log(`   Run ID      : ${result.runId}`);
    console.log(`   Matched     : ${result.summary?.matched}`);
    console.log(`   Conflicting : ${result.summary?.conflicting}`);
    console.log(`   Unmatched   : ${(result.summary?.unmatchedUser ?? 0) + (result.summary?.unmatchedExchange ?? 0)}`);
    console.log(`   Report      : ${result.csvReportPath}`);
    console.log("──────────────────────────────────────\n");
  } else {
    logger.error("❌ Seed failed", { error: result.error });
  }

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  logger.error("Seed script crashed", { error: err });
  process.exit(1);
});
