import type { FilingRecord } from "../sheets";

export interface SearchMatchResult {
  exact: FilingRecord[];
  near: FilingRecord[];
  fuzzy: FilingRecord[];
}

/**
 * Compute the Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,          // deletion
        prev[j - 1] + cost,   // substitution
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Splits a list of filings into three buckets for the given query string.
 * Matching is case-insensitive. A record appears in exactly one bucket —
 * exact → near (contains) → fuzzy (edit distance ≤ 2), in priority order.
 */
export function matchFilings(filings: FilingRecord[], query: string): SearchMatchResult {
  const q = query.toLowerCase();
  const exact = filings.filter((f) => f.username.toLowerCase() === q);
  const near = filings.filter(
    (f) => f.username.toLowerCase() !== q && f.username.toLowerCase().includes(q),
  );
  const exactAndNearLower = new Set([
    ...exact.map((f) => f.username.toLowerCase()),
    ...near.map((f) => f.username.toLowerCase()),
  ]);
  const fuzzy = filings.filter((f) => {
    const storedLower = f.username.toLowerCase();
    if (exactAndNearLower.has(storedLower)) return false;
    return levenshteinDistance(storedLower, q) <= 2;
  });
  return { exact, near, fuzzy };
}
