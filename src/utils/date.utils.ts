/** Returns absolute difference in seconds between two dates */
export function timeDiffSeconds(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 1000;
}

/** Formats seconds into human-readable string e.g. "5m 30s" */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
