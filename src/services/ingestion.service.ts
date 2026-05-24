import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { Transaction, ITransaction } from "../models/Transaction";
import {
  RawTransactionRow,
  ParsedTransaction,
  TransactionSource,
  TransactionType,
  DataQualityIssue,
} from "../types";
import { normalizeAsset } from "../utils/assetNormalizer";
import logger from "../utils/logger";

const VALID_TYPES: TransactionType[] = [
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];

// ─── Parse a single raw CSV row into a ParsedTransaction ────────────────────
function parseRow(
  row: RawTransactionRow,
  source: TransactionSource,
  rowIndex: number
): ParsedTransaction {
  const issues: DataQualityIssue[] = [];

  // ── transaction_id ──────────────────────────────────────────────────────────
  const transactionId =
    row.transaction_id?.trim() ||
    `${source.toUpperCase()}-MISSING-${rowIndex}`;
  if (!row.transaction_id?.trim()) {
    issues.push({
      field: "transaction_id",
      issue: "Missing transaction ID; synthetic ID assigned",
      rawValue: row.transaction_id,
    });
  }

  // ── timestamp ───────────────────────────────────────────────────────────────
  let timestamp: Date | null = null;
  if (!row.timestamp?.trim()) {
    issues.push({
      field: "timestamp",
      issue: "Missing timestamp",
      rawValue: row.timestamp,
    });
  } else {
    const parsed = new Date(row.timestamp.trim());
    if (isNaN(parsed.getTime())) {
      issues.push({
        field: "timestamp",
        issue: "Malformed timestamp; cannot parse",
        rawValue: row.timestamp,
      });
    } else {
      timestamp = parsed;
    }
  }

  // ── type ────────────────────────────────────────────────────────────────────
  let type: TransactionType | null = null;
  const rawType = row.type?.trim().toUpperCase();
  if (!rawType) {
    issues.push({ field: "type", issue: "Missing transaction type" });
  } else if (!VALID_TYPES.includes(rawType as TransactionType)) {
    issues.push({
      field: "type",
      issue: `Unknown transaction type "${rawType}"`,
      rawValue: row.type,
    });
  } else {
    type = rawType as TransactionType;
  }

  // ── asset ───────────────────────────────────────────────────────────────────
  let asset: string | null = null;
  if (!row.asset?.trim()) {
    issues.push({ field: "asset", issue: "Missing asset symbol" });
  } else {
    asset = normalizeAsset(row.asset);
    // Flag if the raw name was non-canonical (e.g. "bitcoin" instead of "BTC")
    if (row.asset.trim() !== asset) {
      logger.debug(
        `Asset alias resolved: "${row.asset.trim()}" → "${asset}" (row ${rowIndex})`
      );
    }
  }

  // ── quantity ────────────────────────────────────────────────────────────────
  let quantity: number | null = null;
  if (row.quantity === undefined || row.quantity === "") {
    issues.push({ field: "quantity", issue: "Missing quantity" });
  } else {
    const q = parseFloat(row.quantity);
    if (isNaN(q)) {
      issues.push({
        field: "quantity",
        issue: "Non-numeric quantity",
        rawValue: row.quantity,
      });
    } else if (q < 0) {
      issues.push({
        field: "quantity",
        issue: "Negative quantity (data error)",
        rawValue: row.quantity,
      });
    } else {
      quantity = q;
    }
  }

  // ── price_usd (optional field, warn only) ──────────────────────────────────
  let priceUsd: number | null = null;
  if (row.price_usd?.trim()) {
    const p = parseFloat(row.price_usd);
    if (isNaN(p)) {
      issues.push({
        field: "price_usd",
        issue: "Non-numeric price_usd",
        rawValue: row.price_usd,
      });
    } else {
      priceUsd = p;
    }
  }

  // ── fee (optional field, warn only) ────────────────────────────────────────
  let fee: number | null = null;
  if (row.fee?.trim()) {
    const f = parseFloat(row.fee);
    if (!isNaN(f)) {
      fee = f;
    }
  }

  // A row is considered valid for matching if it has all critical fields
  const isValid =
    timestamp !== null && type !== null && asset !== null && quantity !== null;

  return {
    transactionId,
    timestamp,
    type,
    asset,
    quantity,
    priceUsd,
    fee,
    note: row.note?.trim() ?? "",
    source,
    rawRow: row,
    isValid,
    qualityIssues: issues,
  };
}

// ─── Parse a CSV file into an array of raw rows ─────────────────────────────
function parseCsvFile(filePath: string): Promise<RawTransactionRow[]> {
  return new Promise((resolve, reject) => {
    const rows: RawTransactionRow[] = [];
    fs.createReadStream(filePath)
      .pipe(
        parse({
          columns: true,       // use first row as keys
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true, // handle rows with extra/missing columns
        })
      )
      .on("data", (row: RawTransactionRow) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

// ─── Detect duplicate transaction IDs within a set ──────────────────────────
function detectDuplicates(transactions: ParsedTransaction[]): void {
  const seen = new Map<string, number>();
  for (const tx of transactions) {
    const count = seen.get(tx.transactionId) ?? 0;
    if (count > 0) {
      tx.qualityIssues.push({
        field: "transaction_id",
        issue: `Duplicate transaction ID "${tx.transactionId}" (occurrence ${count + 1})`,
        rawValue: tx.transactionId,
      });
      tx.isValid = false;
      (tx as ParsedTransaction & { isDuplicate: boolean }).isDuplicate = true;
    }
    seen.set(tx.transactionId, count + 1);
  }
}

// ─── Main ingestion function ─────────────────────────────────────────────────
export async function ingestTransactions(
  runId: string,
  userFilePath: string,
  exchangeFilePath: string
): Promise<{
  userTransactions: ParsedTransaction[];
  exchangeTransactions: ParsedTransaction[];
  totalQualityIssues: number;
}> {
  logger.info(`[${runId}] Starting ingestion`, { userFilePath, exchangeFilePath });

  // ── Parse both CSVs ─────────────────────────────────────────────────────────
  const [userRawRows, exchangeRawRows] = await Promise.all([
    parseCsvFile(userFilePath),
    parseCsvFile(exchangeFilePath),
  ]);

  logger.info(`[${runId}] Parsed raw rows`, {
    userRows: userRawRows.length,
    exchangeRows: exchangeRawRows.length,
  });

  // ── Validate & parse each row ────────────────────────────────────────────────
  const userTransactions = userRawRows.map((row, i) =>
    parseRow(row, "user", i + 1)
  );
  const exchangeTransactions = exchangeRawRows.map((row, i) =>
    parseRow(row, "exchange", i + 1)
  );

  // ── Detect duplicates per source ────────────────────────────────────────────
  detectDuplicates(userTransactions);
  detectDuplicates(exchangeTransactions);

  // ── Log all quality issues ──────────────────────────────────────────────────
  let totalQualityIssues = 0;
  for (const tx of [...userTransactions, ...exchangeTransactions]) {
    if (tx.qualityIssues.length > 0) {
      totalQualityIssues += tx.qualityIssues.length;
      logger.warn(`[${runId}] Data quality issues in ${tx.source} row`, {
        transactionId: tx.transactionId,
        issues: tx.qualityIssues,
      });
    }
  }

  logger.info(`[${runId}] Ingestion complete`, {
    validUser: userTransactions.filter((t) => t.isValid).length,
    invalidUser: userTransactions.filter((t) => !t.isValid).length,
    validExchange: exchangeTransactions.filter((t) => t.isValid).length,
    invalidExchange: exchangeTransactions.filter((t) => !t.isValid).length,
    totalQualityIssues,
  });

  // ── Persist to MongoDB ──────────────────────────────────────────────────────
  const allDocs = [...userTransactions, ...exchangeTransactions].map((tx) => ({
    runId,
    transactionId: tx.transactionId,
    timestamp: tx.timestamp,
    type: tx.type,
    asset: tx.asset,
    normalizedAsset: tx.asset,
    quantity: tx.quantity,
    priceUsd: tx.priceUsd,
    fee: tx.fee,
    note: tx.note,
    source: tx.source,
    rawRow: tx.rawRow,
    isValid: tx.isValid,
    isDuplicate:
      (tx as ParsedTransaction & { isDuplicate?: boolean }).isDuplicate ??
      false,
    qualityIssues: tx.qualityIssues,
  }));

  await Transaction.insertMany(allDocs, { ordered: false });
  logger.info(`[${runId}] Persisted ${allDocs.length} transactions to MongoDB`);

  return { userTransactions, exchangeTransactions, totalQualityIssues };
}

