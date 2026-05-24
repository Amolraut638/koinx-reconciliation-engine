import { matchTransactions } from "../services/matching.service";
import { ParsedTransaction, ReconciliationConfig } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BASE_CONFIG: ReconciliationConfig = {
  timestampToleranceSeconds: 300,
  quantityTolerancePct: 0.0001,
  conflictWindowSeconds: 86400,
  conflictWindowQtyPct: 0.5,
};

function makeTx(
  overrides: Partial<ParsedTransaction> & { transactionId: string }
): ParsedTransaction {
  return {
    timestamp: new Date("2024-03-01T10:00:00Z"),
    type: "BUY",
    asset: "BTC",
    quantity: 0.5,
    priceUsd: 60000,
    fee: 0.001,
    note: "",
    source: "user",
    rawRow: {},
    isValid: true,
    qualityIssues: [],
    ...overrides,
  };
}

// ─── 1. Exact proximity match within tolerance ────────────────────────────────
describe("Proximity matching", () => {
  test("matches transactions within timestamp and quantity tolerance", () => {
    const user = [makeTx({ transactionId: "USR-001", source: "user" })];
    const exchange = [
      makeTx({
        transactionId: "EXC-001",
        source: "exchange",
        timestamp: new Date("2024-03-01T10:02:00Z"), // 120s diff — within 300s
        quantity: 0.50003, // ~0.006% diff — within 0.01%
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("MATCHED");
    expect(entries[0].matchMethod).toBe("proximity");
  });

  test("flags CONFLICTING when quantity exceeds tolerance but within conflict window", () => {
    const user = [makeTx({ transactionId: "USR-002", source: "user" })];
    const exchange = [
      makeTx({
        transactionId: "EXC-002",
        source: "exchange",
        quantity: 0.4, // ~22% diff — outside 0.01%, inside 50% conflict window
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("CONFLICTING");
    expect(entries[0].conflicts?.some((c) => c.field === "quantity")).toBe(true);
  });

  test("flags UNMATCHED_USER when no candidate within conflict window", () => {
    const user = [makeTx({ transactionId: "USR-003", source: "user" })];
    const exchange = [
      makeTx({
        transactionId: "EXC-003",
        source: "exchange",
        quantity: 0.001, // 98% diff — outside 50% conflict window
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    const userUnmatched = entries.filter((e) => e.category === "UNMATCHED_USER");
    expect(userUnmatched).toHaveLength(1);
  });
});

// ─── 2. ID-based matching ─────────────────────────────────────────────────────
describe("ID-based matching (Pass 1)", () => {
  test("matches transactions sharing the same transactionId", () => {
    const user = [makeTx({ transactionId: "SHARED-001", source: "user" })];
    const exchange = [
      makeTx({ transactionId: "SHARED-001", source: "exchange" }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("MATCHED");
    expect(entries[0].matchMethod).toBe("id");
  });

  test("marks CONFLICTING for ID match with field differences beyond tolerance", () => {
    const user = [makeTx({ transactionId: "SHARED-002", source: "user" })];
    const exchange = [
      makeTx({
        transactionId: "SHARED-002",
        source: "exchange",
        quantity: 0.9, // 57% diff
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("CONFLICTING");
    expect(entries[0].matchMethod).toBe("id");
  });
});

// ─── 3. TRANSFER_IN / TRANSFER_OUT perspective flip ────────────────────────────
describe("TRANSFER type perspective mapping", () => {
  test("matches TRANSFER_OUT (user) with TRANSFER_IN (exchange)", () => {
    const user = [
      makeTx({
        transactionId: "USR-T01",
        source: "user",
        type: "TRANSFER_OUT",
      }),
    ];
    const exchange = [
      makeTx({
        transactionId: "EXC-T01",
        source: "exchange",
        type: "TRANSFER_IN",
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("MATCHED");
    expect(entries[0].reason).toContain("perspective flip");
  });

  test("does NOT match TRANSFER_OUT with BUY", () => {
    const user = [
      makeTx({ transactionId: "USR-T02", source: "user", type: "TRANSFER_OUT" }),
    ];
    const exchange = [
      makeTx({ transactionId: "EXC-T02", source: "exchange", type: "BUY" }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries.find((e) => e.category === "MATCHED")).toBeUndefined();
  });
});

// ─── 4. Asset alias normalisation ─────────────────────────────────────────────
describe("Asset alias normalisation", () => {
  test("matches 'bitcoin' (user) with 'BTC' (exchange)", () => {
    const user = [
      makeTx({ transactionId: "USR-A01", source: "user", asset: "bitcoin" }),
    ];
    const exchange = [
      makeTx({ transactionId: "EXC-A01", source: "exchange", asset: "BTC" }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("MATCHED");
  });

  test("matches 'ethereum' (user) with 'ETH' (exchange)", () => {
    const user = [
      makeTx({ transactionId: "USR-A02", source: "user", asset: "ethereum" }),
    ];
    const exchange = [
      makeTx({ transactionId: "EXC-A02", source: "exchange", asset: "ETH" }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("MATCHED");
  });

  test("does NOT match BTC with ETH", () => {
    const user = [
      makeTx({ transactionId: "USR-A03", source: "user", asset: "BTC" }),
    ];
    const exchange = [
      makeTx({ transactionId: "EXC-A03", source: "exchange", asset: "ETH" }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries.find((e) => e.category === "MATCHED")).toBeUndefined();
  });
});

// ─── 5. Invalid / bad row handling ────────────────────────────────────────────
describe("Invalid row handling", () => {
  test("marks invalid user transactions as UNMATCHED_USER with reason", () => {
    const user = [
      makeTx({
        transactionId: "USR-BAD",
        source: "user",
        isValid: false,
        timestamp: null,
        qualityIssues: [{ field: "timestamp", issue: "Missing timestamp" }],
      }),
    ];

    const entries = matchTransactions(user, [], BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("UNMATCHED_USER");
    expect(entries[0].reason).toContain("Missing timestamp");
  });

  test("marks unclaimed exchange transactions as UNMATCHED_EXCHANGE", () => {
    const exchange = [
      makeTx({ transactionId: "EXC-EXTRA", source: "exchange" }),
    ];

    const entries = matchTransactions([], exchange, BASE_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("UNMATCHED_EXCHANGE");
  });
});

// ─── 6. Timestamp tolerance boundary ─────────────────────────────────────────
describe("Timestamp tolerance boundary", () => {
  test("matches when timestamp diff equals tolerance exactly", () => {
    const user = [makeTx({ transactionId: "USR-T10", source: "user" })];
    const exchange = [
      makeTx({
        transactionId: "EXC-T10",
        source: "exchange",
        timestamp: new Date("2024-03-01T10:05:00Z"), // exactly 300s
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries[0].category).toBe("MATCHED");
  });

  test("marks CONFLICTING when timestamp diff just exceeds tolerance", () => {
    const user = [makeTx({ transactionId: "USR-T11", source: "user" })];
    const exchange = [
      makeTx({
        transactionId: "EXC-T11",
        source: "exchange",
        timestamp: new Date("2024-03-01T10:05:01Z"), // 301s
      }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    expect(entries[0].category).toBe("CONFLICTING");
    expect(entries[0].conflicts?.some((c) => c.field === "timestamp")).toBe(true);
  });
});

// ─── 7. No double-claiming of exchange transactions ───────────────────────────
describe("No double-claiming", () => {
  test("one exchange transaction cannot be matched to two user transactions", () => {
    const user = [
      makeTx({ transactionId: "USR-D01", source: "user" }),
      makeTx({ transactionId: "USR-D02", source: "user" }),
    ];
    const exchange = [
      makeTx({ transactionId: "EXC-D01", source: "exchange" }),
    ];

    const entries = matchTransactions(user, exchange, BASE_CONFIG);
    const matched = entries.filter((e) => e.category === "MATCHED");
    expect(matched).toHaveLength(1); // Only one user tx can claim EXC-D01
  });
});
