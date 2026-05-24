import path from "path";
import fs from "fs";
import { stringify } from "csv-stringify/sync";
import {
  ReconciliationRun,
  IReconciliationRun,
} from "../models/ReconciliationRun";
import {
  ReconciliationEntry,
  ReconciliationConfig,
  ReconciliationSummary,
} from "../types";
import logger from "../utils/logger";

// ─── Flatten an entry into a CSV-friendly row ─────────────────────────────────
function flattenEntry(entry: ReconciliationEntry): Record<string, string> {
  const user = entry.userTransaction;
  const exc = entry.exchangeTransaction;

  return {
    category: entry.category,
    match_method: entry.matchMethod ?? "",
    reason: entry.reason,

    // User side
    user_transaction_id: user?.transactionId ?? "",
    user_timestamp: user?.timestamp?.toISOString() ?? "",
    user_type: user?.type ?? "",
    user_asset: user?.asset ?? "",
    user_quantity: user?.quantity?.toString() ?? "",
    user_price_usd: user?.priceUsd?.toString() ?? "",
    user_fee: user?.fee?.toString() ?? "",
    user_note: user?.note ?? "",
    user_quality_issues: user?.qualityIssues.map((q) => q.issue).join(" | ") ?? "",

    // Exchange side
    exchange_transaction_id: exc?.transactionId ?? "",
    exchange_timestamp: exc?.timestamp?.toISOString() ?? "",
    exchange_type: exc?.type ?? "",
    exchange_asset: exc?.asset ?? "",
    exchange_quantity: exc?.quantity?.toString() ?? "",
    exchange_price_usd: exc?.priceUsd?.toString() ?? "",
    exchange_fee: exc?.fee?.toString() ?? "",
    exchange_note: exc?.note ?? "",
    exchange_quality_issues:
      exc?.qualityIssues.map((q) => q.issue).join(" | ") ?? "",

    // Conflicts
    conflicts:
      entry.conflicts?.map((c) => `${c.field}:${c.delta}`).join(" | ") ?? "",
  };
}

// ─── Save reconciliation results to MongoDB ───────────────────────────────────
export async function saveReconciliationRun(
  runId: string,
  ranAt: Date,
  config: ReconciliationConfig,
  entries: ReconciliationEntry[],
  totalUserTransactions: number,
  totalExchangeTransactions: number,
  dataQualityIssues: number
): Promise<IReconciliationRun> {
  const matched = entries.filter((e) => e.category === "MATCHED").length;
  const conflicting = entries.filter((e) => e.category === "CONFLICTING").length;
  const unmatchedUser = entries.filter(
    (e) => e.category === "UNMATCHED_USER"
  ).length;
  const unmatchedExchange = entries.filter(
    (e) => e.category === "UNMATCHED_EXCHANGE"
  ).length;

  const mongoEntries = entries.map((entry) => ({
    category: entry.category,
    reason: entry.reason,
    userTransactionId: entry.userTransaction?.transactionId ?? null,
    exchangeTransactionId: entry.exchangeTransaction?.transactionId ?? null,
    userRawRow: entry.userTransaction?.rawRow,
    exchangeRawRow: entry.exchangeTransaction?.rawRow,
    conflicts: entry.conflicts ?? [],
  }));

  const run = await ReconciliationRun.findOneAndUpdate(
    { runId },
    {
      $set: {
        ranAt,
        config,
        totalUserTransactions,
        totalExchangeTransactions,
        dataQualityIssues,
        entries: mongoEntries,
        summary: { matched, conflicting, unmatchedUser, unmatchedExchange },
        status: "completed",
      },
    },
    { upsert: true, new: true }
  );

  logger.info(`[${runId}] Reconciliation run saved to MongoDB`);
  return run!;
}

// ─── Generate CSV report file ─────────────────────────────────────────────────
export async function generateCsvReport(
  runId: string,
  entries: ReconciliationEntry[]
): Promise<string> {
  const reportsDir = path.resolve(__dirname, "../../reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const filePath = path.join(reportsDir, `reconciliation_${runId}.csv`);
  const rows = entries.map(flattenEntry);

  const csv = stringify(rows, { header: true });
  fs.writeFileSync(filePath, csv, "utf-8");

  logger.info(`[${runId}] CSV report written to ${filePath}`);
  return filePath;
}

// ─── Fetch full report from MongoDB ──────────────────────────────────────────
export async function getFullReport(runId: string) {
  return ReconciliationRun.findOne({ runId }).lean();
}

// ─── Fetch summary ─────────────────────────────────────────────────────────────
export async function getReportSummary(
  runId: string
): Promise<ReconciliationSummary | null> {
  const run = await ReconciliationRun.findOne({ runId })
    .select(
      "runId ranAt config summary totalUserTransactions totalExchangeTransactions dataQualityIssues status"
    )
    .lean();

  if (!run) return null;

  return {
    runId: run.runId,
    ranAt: run.ranAt,
    config: run.config,
    totalUserTransactions: run.totalUserTransactions,
    totalExchangeTransactions: run.totalExchangeTransactions,
    matched: run.summary.matched,
    conflicting: run.summary.conflicting,
    unmatchedUser: run.summary.unmatchedUser,
    unmatchedExchange: run.summary.unmatchedExchange,
    dataQualityIssues: run.dataQualityIssues,
  };
}

// ─── Fetch only unmatched entries ─────────────────────────────────────────────
export async function getUnmatchedEntries(runId: string) {
  const run = await ReconciliationRun.findOne({ runId }).lean();
  if (!run) return null;

  return run.entries.filter(
    (e) =>
      e.category === "UNMATCHED_USER" || e.category === "UNMATCHED_EXCHANGE"
  );
}
