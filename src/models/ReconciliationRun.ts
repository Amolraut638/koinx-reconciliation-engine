import mongoose, { Schema, Document } from "mongoose";
import { ReconciliationConfig, ReconciliationCategory, ConflictDetail, MatchMethod } from "../types";

export interface IReconciliationEntry {
  category: ReconciliationCategory;
  reason: string;
  matchMethod?: MatchMethod;
  userTransactionId?: string | null;
  exchangeTransactionId?: string | null;
  userRawRow?: Record<string, string | undefined>;
  exchangeRawRow?: Record<string, string | undefined>;
  conflicts?: ConflictDetail[];
}

export interface IReconciliationRun extends Document {
  runId: string;
  ranAt: Date;
  config: ReconciliationConfig;
  totalUserTransactions: number;
  totalExchangeTransactions: number;
  dataQualityIssues: number;
  entries: IReconciliationEntry[];
  summary: {
    matched: number;
    conflicting: number;
    unmatchedUser: number;
    unmatchedExchange: number;
  };
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage?: string;
}

const ConflictDetailSchema = new Schema<ConflictDetail>(
  {
    field: { type: String, required: true },
    userValue: { type: Schema.Types.Mixed, default: null },
    exchangeValue: { type: Schema.Types.Mixed, default: null },
    delta: { type: String },
  },
  { _id: false }
);

const ReconciliationEntrySchema = new Schema<IReconciliationEntry>(
  {
    category: {
      type: String,
      enum: ["MATCHED", "CONFLICTING", "UNMATCHED_USER", "UNMATCHED_EXCHANGE"],
      required: true,
    },
    reason: { type: String, required: true },
    matchMethod: { type: String, enum: ["id", "proximity"] },
    userTransactionId: { type: String, default: null },
    exchangeTransactionId: { type: String, default: null },
    userRawRow: { type: Schema.Types.Mixed },
    exchangeRawRow: { type: Schema.Types.Mixed },
    conflicts: { type: [ConflictDetailSchema], default: [] },
  },
  { _id: false }
);

const ReconciliationRunSchema = new Schema<IReconciliationRun>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    ranAt: { type: Date, required: true },
    config: {
      timestampToleranceSeconds: { type: Number, required: true },
      quantityTolerancePct: { type: Number, required: true },
      conflictWindowSeconds: { type: Number, required: true },
      conflictWindowQtyPct: { type: Number, required: true },
    },
    totalUserTransactions: { type: Number, default: 0 },
    totalExchangeTransactions: { type: Number, default: 0 },
    dataQualityIssues: { type: Number, default: 0 },
    entries: { type: [ReconciliationEntrySchema], default: [] },
    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    errorMessage: { type: String },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    collection: "reconciliation_runs",
  }
);

export const ReconciliationRun = mongoose.model<IReconciliationRun>(
  "ReconciliationRun",
  ReconciliationRunSchema
);
