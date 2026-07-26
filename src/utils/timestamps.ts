/** Returns a valid ISO timestamp that is strictly newer than the prior value. */
export function nextIsoTimestamp(previous: string | null = null): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN;
  const floor = Number.isFinite(previousMs) ? previousMs + 1 : 0;
  return new Date(Math.max(Date.now(), floor)).toISOString();
}
