// ─── Raw CSV Row ─────────────────────────────────────────────────────────────
export interface RawTransactionRow {
  transaction_id?: string;
  timestamp?: string;
  type?: string;
  asset?: string;
  quantity?: string;
  price_usd?: string;
  fee?: string;
  note?: string;
  [key: string]: string | undefined;
}

// ─── Transaction Source ───────────────────────────────────────────────────────
export type TransactionSource = "user" | "exchange";

// ─── Transaction Types ────────────────────────────────────────────────────────
export type TransactionType = "BUY" | "SELL" | "TRANSFER_IN" | "TRANSFER_OUT";

// ─── Data Quality Issue ───────────────────────────────────────────────────────
export interface DataQualityIssue {
  field: string;
  issue: string;
  rawValue?: string;
}

// ─── Parsed Transaction ───────────────────────────────────────────────────────
export interface ParsedTransaction {
  transactionId: string;
  timestamp: Date | null;
  type: TransactionType | null;
  asset: string | null;
  quantity: number | null;
  priceUsd: number | null;
  fee: number | null;
  note: string;
  source: TransactionSource;
  rawRow: RawTransactionRow;
  isValid: boolean;
  isDuplicate?: boolean;
  qualityIssues: DataQualityIssue[];
}

// ─── Reconciliation Config ────────────────────────────────────────────────────
export interface ReconciliationConfig {
  /** Max timestamp delta (seconds) for a MATCH. Default: 300 (5 min) */
  timestampToleranceSeconds: number;
  /** Max quantity % delta (decimal) for a MATCH. e.g. 0.0001 = 0.01%. Default: 0.0001 */
  quantityTolerancePct: number;
  /**
   * Max timestamp delta (seconds) to still classify as CONFLICTING
   * (rather than UNMATCHED). Default: 86400 (24 hours)
   */
  conflictWindowSeconds: number;
  /**
   * Max quantity % delta (decimal) to still classify as CONFLICTING
   * (rather than UNMATCHED). Default: 0.5 (50%)
   */
  conflictWindowQtyPct: number;
}

// ─── Reconciliation Category ──────────────────────────────────────────────────
export type ReconciliationCategory =
  | "MATCHED"
  | "CONFLICTING"
  | "UNMATCHED_USER"
  | "UNMATCHED_EXCHANGE";

// ─── Match Method ─────────────────────────────────────────────────────────────
export type MatchMethod = "id" | "proximity";

// ─── Reconciliation Result Entry ──────────────────────────────────────────────
export interface ReconciliationEntry {
  category: ReconciliationCategory;
  reason: string;
  matchMethod?: MatchMethod;
  userTransaction?: ParsedTransaction;
  exchangeTransaction?: ParsedTransaction;
  conflicts?: ConflictDetail[];
}

// ─── Conflict Detail ──────────────────────────────────────────────────────────
export interface ConflictDetail {
  field: string;
  userValue: string | number | null;
  exchangeValue: string | number | null;
  delta?: string;
}

// ─── Reconciliation Summary ───────────────────────────────────────────────────
export interface ReconciliationSummary {
  runId: string;
  ranAt: Date;
  config: ReconciliationConfig;
  totalUserTransactions: number;
  totalExchangeTransactions: number;
  matched: number;
  conflicting: number;
  unmatchedUser: number;
  unmatchedExchange: number;
  dataQualityIssues: number;
}
