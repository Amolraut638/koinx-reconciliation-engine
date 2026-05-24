import mongoose, { Schema, Document } from "mongoose";
import { TransactionSource, TransactionType, DataQualityIssue } from "../types";

export interface ITransaction extends Document {
  runId: string;
  transactionId: string;
  timestamp: Date | null;
  type: TransactionType | null;
  asset: string | null;
  normalizedAsset: string | null;
  quantity: number | null;
  priceUsd: number | null;
  fee: number | null;
  note: string;
  source: TransactionSource;
  rawRow: Record<string, string | undefined>;
  isValid: boolean;
  isDuplicate: boolean;
  qualityIssues: DataQualityIssue[];
  createdAt: Date;
}

const DataQualityIssueSchema = new Schema<DataQualityIssue>(
  {
    field: { type: String, required: true },
    issue: { type: String, required: true },
    rawValue: { type: String },
  },
  { _id: false }
);

const TransactionSchema = new Schema<ITransaction>(
  {
    runId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true },
    timestamp: { type: Date, default: null },
    type: {
      type: String,
      enum: ["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", null],
      default: null,
    },
    asset: { type: String, default: null },
    normalizedAsset: { type: String, default: null },
    quantity: { type: Number, default: null },
    priceUsd: { type: Number, default: null },
    fee: { type: Number, default: null },
    note: { type: String, default: "" },
    source: { type: String, enum: ["user", "exchange"], required: true },
    rawRow: { type: Schema.Types.Mixed, required: true },
    isValid: { type: Boolean, required: true },
    isDuplicate: { type: Boolean, default: false },
    qualityIssues: { type: [DataQualityIssueSchema], default: [] },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
    collection: "transactions",
  }
);

// Compound index for efficient matching queries
TransactionSchema.index({ runId: 1, source: 1, normalizedAsset: 1, timestamp: 1 });

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  TransactionSchema
);
