/**
 * Returns the percentage difference between two quantities as a decimal.
 * Uses the average of both values as the denominator to avoid directional bias.
 * e.g. quantityDiffPct(0.3, 0.3001) → 0.000333... (0.0333%)
 */
export function quantityDiffPct(a: number, b: number): number {
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  if (avg === 0) return 0;
  return Math.abs(a - b) / avg;
}

/** Formats a decimal diff as a human-readable percentage string */
export function formatPct(decimal: number): string {
  return `${(decimal * 100).toFixed(6)}%`;
}
