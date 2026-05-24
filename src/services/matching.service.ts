import {
  ParsedTransaction,
  ReconciliationConfig,
  ReconciliationEntry,
  ConflictDetail,
  TransactionType,
  MatchMethod,
} from "../types";
import { timeDiffSeconds, formatSeconds } from "../utils/date.utils";
import { quantityDiffPct, formatPct } from "../utils/quantity.utils";
import { assetsMatch } from "../utils/assetNormalizer";
import logger from "../utils/logger";

// ─── Type compatibility ────────────────────────────────────────────────────────
/**
 * Exchange records TRANSFER_IN (asset arrives at exchange).
 * User records TRANSFER_OUT (asset leaves their wallet).
 * Both describe the same physical event from opposite perspectives.
 */
function typesAreCompatible(a: TransactionType, b: TransactionType): boolean {
  if (a === b) return true;
  if (
    (a === "TRANSFER_IN" && b === "TRANSFER_OUT") ||
    (a === "TRANSFER_OUT" && b === "TRANSFER_IN")
  )
    return true;
  return false;
}

// ─── Conflict detail builder ───────────────────────────────────────────────────
/**
 * Return every field that differs beyond the given tolerances.
 * Pass tolerances=0 to capture ALL differences (used for CONFLICTING entries).
 */
function buildConflictDetails(
  user: ParsedTransaction,
  exchange: ParsedTransaction,
  timeTolerance: number,
  qtyTolerance: number
): ConflictDetail[] {
  const details: ConflictDetail[] = [];

  if (user.quantity !== null && exchange.quantity !== null) {
    const pct = quantityDiffPct(user.quantity, exchange.quantity);
    if (pct > qtyTolerance) {
      details.push({
        field: "quantity",
        userValue: user.quantity,
        exchangeValue: exchange.quantity,
        delta: `${formatPct(pct)} difference`,
      });
    }
  }

  if (user.timestamp && exchange.timestamp) {
    const secs = timeDiffSeconds(user.timestamp, exchange.timestamp);
    if (secs > timeTolerance) {
      details.push({
        field: "timestamp",
        userValue: user.timestamp.toISOString(),
        exchangeValue: exchange.timestamp.toISOString(),
        delta: `${formatSeconds(secs)} difference`,
      });
    }
  }

  return details;
}

// ─── Candidate type for proximity matching ─────────────────────────────────────
interface ProximityCandidate {
  exchange: ParsedTransaction;
  timeDiff: number;
  qtyDiff: number;
  /** Lower = better */
  score: number;
}

function scoreProximity(
  user: ParsedTransaction,
  exchange: ParsedTransaction
): ProximityCandidate {
  const timeDiff =
    user.timestamp && exchange.timestamp
      ? timeDiffSeconds(user.timestamp, exchange.timestamp)
      : Infinity;
  const qtyDiff =
    user.quantity !== null && exchange.quantity !== null
      ? quantityDiffPct(user.quantity, exchange.quantity)
      : Infinity;

  // Normalised weighted score — timestamp scaled to seconds, qty scaled to pct
  // Weighted equally after normalisation so neither dominates
  const score = timeDiff / 60 + qtyDiff * 100;
  return { exchange, timeDiff, qtyDiff, score };
}

// ─── Main Matching Engine ──────────────────────────────────────────────────────
export function matchTransactions(
  userTransactions: ParsedTransaction[],
  exchangeTransactions: ParsedTransaction[],
  config: ReconciliationConfig
): ReconciliationEntry[] {
  logger.info("Starting matching engine", {
    userCount: userTransactions.length,
    exchangeCount: exchangeTransactions.length,
    config,
  });

  const entries: ReconciliationEntry[] = [];

  // Track which exchange rows have already been claimed
  const claimedExchangeIds = new Set<string>();

  const validUser = userTransactions.filter((t) => t.isValid);
  const validExchange = exchangeTransactions.filter((t) => t.isValid);

  // ── Build lookup maps for ID-based matching ──────────────────────────────────
  // Maps transaction_id → ParsedTransaction for each source
  const exchangeById = new Map<string, ParsedTransaction>(
    validExchange.map((t) => [t.transactionId, t])
  );

  // ════════════════════════════════════════════════════════════════════════════
  // PASS 1 — ID-based matching
  //   Some datasets share a common transaction ID across user and exchange files.
  //   Match these first; they take priority over proximity matching.
  // ════════════════════════════════════════════════════════════════════════════
  const unmatchedAfterIdPass: ParsedTransaction[] = [];

  for (const user of validUser) {
    const exchangeById_match = exchangeById.get(user.transactionId);

    if (!exchangeById_match || claimedExchangeIds.has(exchangeById_match.transactionId)) {
      // No ID-based match found — defer to proximity pass
      unmatchedAfterIdPass.push(user);
      continue;
    }

    const exc = exchangeById_match;

    // Validate compatibility (defensive: shared IDs should agree, but verify)
    const assetOk = assetsMatch(user.asset!, exc.asset!);
    const typeOk = typesAreCompatible(user.type!, exc.type!);

    if (!assetOk || !typeOk) {
      // Same ID but different asset/type — this is a data anomaly; treat as conflict
      claimedExchangeIds.add(exc.transactionId);
      entries.push({
        category: "CONFLICTING",
        reason: `ID match found (${user.transactionId}) but asset or type mismatch: ` +
          `user=${user.asset}/${user.type}, exchange=${exc.asset}/${exc.type}`,
        matchMethod: "id",
        userTransaction: user,
        exchangeTransaction: exc,
        conflicts: [
          ...(!assetOk
            ? [{ field: "asset", userValue: user.asset, exchangeValue: exc.asset }]
            : []),
          ...(!typeOk
            ? [{ field: "type", userValue: user.type, exchangeValue: exc.type }]
            : []),
        ],
      });
      continue;
    }

    const timeDiff = user.timestamp && exc.timestamp
      ? timeDiffSeconds(user.timestamp, exc.timestamp)
      : Infinity;
    const qtyDiff = user.quantity !== null && exc.quantity !== null
      ? quantityDiffPct(user.quantity, exc.quantity)
      : Infinity;

    const withinTolerance =
      timeDiff <= config.timestampToleranceSeconds &&
      qtyDiff <= config.quantityTolerancePct;

    claimedExchangeIds.add(exc.transactionId);

    if (withinTolerance) {
      entries.push({
        category: "MATCHED",
        reason:
          `ID match: ${user.transactionId}. ` +
          `Δt=${formatSeconds(timeDiff)}, Δqty=${formatPct(qtyDiff)}`,
        matchMethod: "id",
        userTransaction: user,
        exchangeTransaction: exc,
        conflicts: [],
      });
    } else {
      // ID match but fields differ beyond tolerance → CONFLICTING
      const conflicts = buildConflictDetails(user, exc, 0, 0);
      entries.push({
        category: "CONFLICTING",
        reason:
          `ID match: ${user.transactionId}, but key fields differ beyond tolerance. ` +
          buildConflictReason(conflicts),
        matchMethod: "id",
        userTransaction: user,
        exchangeTransaction: exc,
        conflicts,
      });
    }
  }

  logger.info(`Pass 1 (ID-based) complete`, {
    idMatched: validUser.length - unmatchedAfterIdPass.length,
    deferredToProximity: unmatchedAfterIdPass.length,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PASS 2 — Proximity-based matching (for rows not resolved in Pass 1)
  //   Match on: asset (normalised) + compatible type + closest timestamp/quantity.
  //   Decision tree for best candidate:
  //     within match tolerance          → MATCHED
  //     outside match, within conflict window → CONFLICTING
  //     outside conflict window          → UNMATCHED_USER
  // ════════════════════════════════════════════════════════════════════════════
  for (const user of unmatchedAfterIdPass) {
    const candidates: ProximityCandidate[] = [];

    for (const exc of validExchange) {
      if (claimedExchangeIds.has(exc.transactionId)) continue;
      if (!assetsMatch(user.asset!, exc.asset!)) continue;
      if (!typesAreCompatible(user.type!, exc.type!)) continue;

      const candidate = scoreProximity(user, exc);

      // Only gather candidates within the conflict window —
      // anything further away cannot even be CONFLICTING
      const withinConflictWindow =
        candidate.timeDiff <= config.conflictWindowSeconds &&
        candidate.qtyDiff <= config.conflictWindowQtyPct;

      if (withinConflictWindow) {
        candidates.push(candidate);
      }
    }

    if (candidates.length === 0) {
      entries.push({
        category: "UNMATCHED_USER",
        reason: "No matching transaction found in exchange data (asset+type+proximity search exhausted)",
        userTransaction: user,
      });
      continue;
    }

    // Best candidate = lowest score
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];

    const withinMatchTolerance =
      best.timeDiff <= config.timestampToleranceSeconds &&
      best.qtyDiff <= config.quantityTolerancePct;

    claimedExchangeIds.add(best.exchange.transactionId);

    if (withinMatchTolerance) {
      // ── MATCHED ────────────────────────────────────────────────────────────
      const isTransferFlip = user.type !== best.exchange.type;
      const reason =
        `Proximity match on asset (${user.asset}), type (${user.type}↔${best.exchange.type}). ` +
        `Δt=${formatSeconds(best.timeDiff)}, Δqty=${formatPct(best.qtyDiff)}.` +
        (isTransferFlip ? ` [TRANSFER perspective flip]` : "");

      entries.push({
        category: "MATCHED",
        reason,
        matchMethod: "proximity",
        userTransaction: user,
        exchangeTransaction: best.exchange,
        conflicts: [],
      });
    } else {
      // ── CONFLICTING ────────────────────────────────────────────────────────
      const conflicts = buildConflictDetails(user, best.exchange, 0, 0);
      entries.push({
        category: "CONFLICTING",
        reason:
          `Proximity match found (asset=${user.asset}, type=${user.type}↔${best.exchange.type}), ` +
          `but fields differ beyond tolerance. ` +
          buildConflictReason(conflicts),
        matchMethod: "proximity",
        userTransaction: user,
        exchangeTransaction: best.exchange,
        conflicts,
      });
    }
  }

  logger.info(`Pass 2 (proximity) complete`);

  // ════════════════════════════════════════════════════════════════════════════
  // PASS 3 — Invalid user transactions
  //   Cannot participate in matching; emitted as UNMATCHED_USER with the
  //   specific quality issue(s) as the reason.
  // ════════════════════════════════════════════════════════════════════════════
  for (const user of userTransactions.filter((t) => !t.isValid)) {
    entries.push({
      category: "UNMATCHED_USER",
      reason: `Record failed validation — cannot match. Issues: ${user.qualityIssues
        .map((q) => `[${q.field}] ${q.issue}`)
        .join("; ")}`,
      userTransaction: user,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PASS 4 — Unclaimed exchange transactions
  //   Any exchange row not claimed in passes 1–2 is UNMATCHED_EXCHANGE.
  // ════════════════════════════════════════════════════════════════════════════
  for (const exc of exchangeTransactions) {
    if (claimedExchangeIds.has(exc.transactionId)) continue;

    if (!exc.isValid) {
      entries.push({
        category: "UNMATCHED_EXCHANGE",
        reason: `Record failed validation — cannot match. Issues: ${exc.qualityIssues
          .map((q) => `[${q.field}] ${q.issue}`)
          .join("; ")}`,
        exchangeTransaction: exc,
      });
    } else {
      entries.push({
        category: "UNMATCHED_EXCHANGE",
        reason: "No matching transaction found in user data",
        exchangeTransaction: exc,
      });
    }
  }

  // ─── Summary log ───────────────────────────────────────────────────────────
  const matched = entries.filter((e) => e.category === "MATCHED").length;
  const conflicting = entries.filter((e) => e.category === "CONFLICTING").length;
  const unmatchedUser = entries.filter((e) => e.category === "UNMATCHED_USER").length;
  const unmatchedExchange = entries.filter(
    (e) => e.category === "UNMATCHED_EXCHANGE"
  ).length;

  logger.info("Matching engine complete", {
    matched,
    conflicting,
    unmatchedUser,
    unmatchedExchange,
  });

  return entries;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function buildConflictReason(conflicts: ConflictDetail[]): string {
  if (conflicts.length === 0) return "No specific field conflicts detected.";
  return conflicts.map((c) => `${c.field} (${c.delta})`).join(", ");
}
