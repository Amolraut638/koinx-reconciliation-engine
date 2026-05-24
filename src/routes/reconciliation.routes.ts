import { Router } from "express";
import {
  triggerReconciliation,
  getFullReportHandler,
  getReportSummaryHandler,
  getUnmatchedHandler,
} from "../controllers/reconciliation.controller";

const router = Router();

/**
 * @swagger
 * /reconcile:
 *   post:
 *     summary: Trigger a new reconciliation run
 *     description: >
 *       Ingests both CSV datasets, runs the matching engine, and produces a
 *       reconciliation report. All tolerance parameters are optional and override
 *       the environment defaults for this run only.
 *     tags: [Reconciliation]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReconcileBody'
 *     responses:
 *       200:
 *         description: Reconciliation completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReconcileResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Reconciliation run failed
 */
router.post("/reconcile", triggerReconciliation);

/**
 * @swagger
 * /report/{runId}:
 *   get:
 *     summary: Fetch the full reconciliation report
 *     description: >
 *       Returns all entries for a run — both sides of each transaction, category,
 *       reason, match method, and field-level conflict details.
 *     tags: [Reports]
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID returned by POST /reconcile
 *     responses:
 *       200:
 *         description: Full reconciliation report
 *       404:
 *         description: Run not found
 */
router.get("/report/:runId", getFullReportHandler);

/**
 * @swagger
 * /report/{runId}/summary:
 *   get:
 *     summary: Fetch reconciliation counts summary
 *     description: >
 *       Returns a lightweight summary — matched, conflicting, unmatched counts
 *       and the config used for this run.
 *     tags: [Reports]
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Summary counts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SummaryResponse'
 *       404:
 *         description: Run not found
 */
router.get("/report/:runId/summary", getReportSummaryHandler);

/**
 * @swagger
 * /report/{runId}/unmatched:
 *   get:
 *     summary: Fetch only unmatched entries
 *     description: >
 *       Returns only UNMATCHED_USER and UNMATCHED_EXCHANGE entries with reasons.
 *       Useful for quickly identifying transactions that need manual review.
 *     tags: [Reports]
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Unmatched entries
 *       404:
 *         description: Run not found
 */
router.get("/report/:runId/unmatched", getUnmatchedHandler);

export default router;
