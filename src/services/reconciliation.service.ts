import path from "path";
import { v4 as uuidv4 } from "uuid";
import config from "../config";
import { ReconciliationConfig } from "../types";
import { ingestTransactions } from "./ingestion.service";
import { matchTransactions } from "./matching.service";
import { saveReconciliationRun, generateCsvReport } from "./report.service";
import { ReconciliationRun } from "../models/ReconciliationRun";
import logger from "../utils/logger";

export interface ReconcileOptions {
  /** Override env default for match tolerance (seconds) */
  timestampToleranceSeconds?: number;
  /** Override env default for match tolerance (decimal, e.g. 0.0001 = 0.01%) */
  quantityTolerancePct?: number;
  /** Override env default for conflict window (seconds) */
  conflictWindowSeconds?: number;
  /** Override env default for conflict window quantity (decimal) */
  conflictWindowQtyPct?: number;
  /** Optional: path to user CSV (defaults to ./data/user_transactions.csv) */
  userCsvPath?: string;
  /** Optional: path to exchange CSV (defaults to ./data/exchange_transactions.csv) */
  exchangeCsvPath?: string;
}

export interface ReconcileResult {
  runId: string;
  status: "completed" | "failed";
  summary?: {
    matched: number;
    conflicting: number;
    unmatchedUser: number;
    unmatchedExchange: number;
    dataQualityIssues: number;
  };
  csvReportPath?: string;
  error?: string;
}

function resolveFilePaths(options: ReconcileOptions): {
  userFilePath: string;
  exchangeFilePath: string;
} {
  const dataDir = path.resolve(__dirname, "../../data");
  return {
    userFilePath:
      options.userCsvPath ??
      process.env.USER_CSV_PATH ??
      path.join(dataDir, "user_transactions.csv"),
    exchangeFilePath:
      options.exchangeCsvPath ??
      process.env.EXCHANGE_CSV_PATH ??
      path.join(dataDir, "exchange_transactions.csv"),
  };
}

export async function runReconciliation(
  options: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const runId = uuidv4();
  const ranAt = new Date();

  // Build effective config: request body overrides > env vars > hardcoded defaults
  const effectiveConfig: ReconciliationConfig = {
    timestampToleranceSeconds:
      options.timestampToleranceSeconds ??
      config.matching.timestampToleranceSeconds,
    quantityTolerancePct:
      options.quantityTolerancePct ?? config.matching.quantityTolerancePct,
    conflictWindowSeconds:
      options.conflictWindowSeconds ?? config.matching.conflictWindowSeconds,
    conflictWindowQtyPct:
      options.conflictWindowQtyPct ?? config.matching.conflictWindowQtyPct,
  };

  logger.info(`[${runId}] Reconciliation run started`, { effectiveConfig });

  // Create pending run document immediately — callers can poll status
  await ReconciliationRun.create({
    runId,
    ranAt,
    config: effectiveConfig,
    status: "processing",
  });

  try {
    const { userFilePath, exchangeFilePath } = resolveFilePaths(options);

    // Step 1: Ingest both CSV files
    const { userTransactions, exchangeTransactions, totalQualityIssues } =
      await ingestTransactions(runId, userFilePath, exchangeFilePath);

    // Step 2: Match transactions
    const entries = matchTransactions(
      userTransactions,
      exchangeTransactions,
      effectiveConfig
    );

    // Step 3: Persist results + generate CSV report
    const run = await saveReconciliationRun(
      runId,
      ranAt,
      effectiveConfig,
      entries,
      userTransactions.length,
      exchangeTransactions.length,
      totalQualityIssues
    );

    const csvPath = await generateCsvReport(runId, entries);

    logger.info(`[${runId}] Reconciliation completed`, {
      summary: run.summary,
      csvPath,
    });

    return {
      runId,
      status: "completed",
      summary: {
        matched: run.summary.matched,
        conflicting: run.summary.conflicting,
        unmatchedUser: run.summary.unmatchedUser,
        unmatchedExchange: run.summary.unmatchedExchange,
        dataQualityIssues: totalQualityIssues,
      },
      csvReportPath: csvPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[${runId}] Reconciliation failed`, { error: message });

    await ReconciliationRun.updateOne(
      { runId },
      { $set: { status: "failed", errorMessage: message } }
    );

    return { runId, status: "failed", error: message };
  }
}
