import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ReconcileBodySchema } from "../validations/reconcile.validation";
import { runReconciliation } from "../services/reconciliation.service";
import {
  getFullReport,
  getReportSummary,
  getUnmatchedEntries,
} from "../services/report.service";
import logger from "../utils/logger";

// ─── POST /reconcile ──────────────────────────────────────────────────────────
export async function triggerReconciliation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Zod validation
    const parsed = ReconcileBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const details = (parsed.error as ZodError).errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`
      );
      res.status(400).json({ error: "Validation failed", details });
      return;
    }

    const body = parsed.data;
    logger.info("POST /reconcile — validated body", body);

    const result = await runReconciliation(body);
    res.status(result.status === "completed" ? 200 : 500).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /report/:runId ───────────────────────────────────────────────────────
export async function getFullReportHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { runId } = req.params;
    const report = await getFullReport(runId);
    if (!report) {
      res.status(404).json({ error: `Run "${runId}" not found` });
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
}

// ─── GET /report/:runId/summary ───────────────────────────────────────────────
export async function getReportSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { runId } = req.params;
    const summary = await getReportSummary(runId);
    if (!summary) {
      res.status(404).json({ error: `Run "${runId}" not found` });
      return;
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

// ─── GET /report/:runId/unmatched ─────────────────────────────────────────────
export async function getUnmatchedHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { runId } = req.params;
    const unmatched = await getUnmatchedEntries(runId);
    if (!unmatched) {
      res.status(404).json({ error: `Run "${runId}" not found` });
      return;
    }
    res.json({ runId, count: unmatched.length, entries: unmatched });
  } catch (err) {
    next(err);
  }
}
