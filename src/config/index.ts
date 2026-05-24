import dotenv from "dotenv";

dotenv.config();

const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  mongoUri:
    process.env.MONGODB_URI ?? "mongodb://localhost:27017/reconciliation-engine",

  matching: {
    timestampToleranceSeconds: parseInt(
      process.env.TIMESTAMP_TOLERANCE_SECONDS ?? "300",
      10
    ),
    quantityTolerancePct: parseFloat(
      process.env.QUANTITY_TOLERANCE_PCT ?? "0.0001"
    ),
    conflictWindowSeconds: parseInt(
      process.env.CONFLICT_WINDOW_SECONDS ?? "86400",
      10
    ),
    conflictWindowQtyPct: parseFloat(
      process.env.CONFLICT_WINDOW_QTY_PCT ?? "0.5"
    ),
  },
};

export default config;
