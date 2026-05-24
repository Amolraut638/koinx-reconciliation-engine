import swaggerJsdoc from "swagger-jsdoc";
import config from "./index";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Transaction Reconciliation Engine",
      version: "1.0.0",
      description:
        "A production-grade crypto transaction reconciliation engine that matches " +
        "user-exported and exchange-exported transaction data, identifies discrepancies, " +
        "and generates structured reports.",
      contact: { name: "KoinX Assignment" },
    },
    servers: [{ url: `http://localhost:${config.port}`, description: "Local" }],
    components: {
      schemas: {
        ReconcileBody: {
          type: "object",
          properties: {
            timestampToleranceSeconds: {
              type: "number",
              example: 300,
              description: "Max timestamp delta (seconds) for a MATCHED result",
            },
            quantityTolerancePct: {
              type: "number",
              example: 0.0001,
              description: "Max quantity % delta (decimal) for a MATCHED result. e.g. 0.0001 = 0.01%",
            },
            conflictWindowSeconds: {
              type: "number",
              example: 86400,
              description:
                "Max timestamp delta (seconds) for a CONFLICTING result. Beyond this → UNMATCHED",
            },
            conflictWindowQtyPct: {
              type: "number",
              example: 0.5,
              description:
                "Max quantity % delta (decimal) for a CONFLICTING result. Beyond this → UNMATCHED",
            },
            userCsvPath: {
              type: "string",
              example: "./data/user_transactions.csv",
              description: "Override path to user CSV file",
            },
            exchangeCsvPath: {
              type: "string",
              example: "./data/exchange_transactions.csv",
              description: "Override path to exchange CSV file",
            },
          },
        },
        ReconcileResponse: {
          type: "object",
          properties: {
            runId: { type: "string", example: "550e8400-e29b-41d4-a716-446655440000" },
            status: { type: "string", enum: ["completed", "failed"] },
            summary: {
              type: "object",
              properties: {
                matched: { type: "number", example: 18 },
                conflicting: { type: "number", example: 1 },
                unmatchedUser: { type: "number", example: 5 },
                unmatchedExchange: { type: "number", example: 2 },
                dataQualityIssues: { type: "number", example: 7 },
              },
            },
            csvReportPath: { type: "string", example: "./reports/reconciliation_<runId>.csv" },
          },
        },
        SummaryResponse: {
          type: "object",
          properties: {
            runId: { type: "string" },
            ranAt: { type: "string", format: "date-time" },
            config: {
              type: "object",
              properties: {
                timestampToleranceSeconds: { type: "number" },
                quantityTolerancePct: { type: "number" },
                conflictWindowSeconds: { type: "number" },
                conflictWindowQtyPct: { type: "number" },
              },
            },
            totalUserTransactions: { type: "number" },
            totalExchangeTransactions: { type: "number" },
            matched: { type: "number" },
            conflicting: { type: "number" },
            unmatchedUser: { type: "number" },
            unmatchedExchange: { type: "number" },
            dataQualityIssues: { type: "number" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            details: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
