import { z } from "zod";

export const ReconcileBodySchema = z
  .object({
    timestampToleranceSeconds: z
      .number({ invalid_type_error: "timestampToleranceSeconds must be a number" })
      .positive("timestampToleranceSeconds must be positive")
      .optional(),

    quantityTolerancePct: z
      .number({ invalid_type_error: "quantityTolerancePct must be a number" })
      .min(0, "quantityTolerancePct must be >= 0")
      .max(1, "quantityTolerancePct must be <= 1")
      .optional(),

    conflictWindowSeconds: z
      .number({ invalid_type_error: "conflictWindowSeconds must be a number" })
      .positive("conflictWindowSeconds must be positive")
      .optional(),

    conflictWindowQtyPct: z
      .number({ invalid_type_error: "conflictWindowQtyPct must be a number" })
      .min(0, "conflictWindowQtyPct must be >= 0")
      .max(1, "conflictWindowQtyPct must be <= 1")
      .optional(),

    userCsvPath: z.string().min(1).optional(),
    exchangeCsvPath: z.string().min(1).optional(),
  })
  .refine(
    (d) =>
      d.timestampToleranceSeconds === undefined ||
      d.conflictWindowSeconds === undefined ||
      d.conflictWindowSeconds >= d.timestampToleranceSeconds,
    {
      message: "conflictWindowSeconds must be >= timestampToleranceSeconds",
      path: ["conflictWindowSeconds"],
    }
  )
  .refine(
    (d) =>
      d.quantityTolerancePct === undefined ||
      d.conflictWindowQtyPct === undefined ||
      d.conflictWindowQtyPct >= d.quantityTolerancePct,
    {
      message: "conflictWindowQtyPct must be >= quantityTolerancePct",
      path: ["conflictWindowQtyPct"],
    }
  );

export type ReconcileBody = z.infer<typeof ReconcileBodySchema>;
