import type { FilingRecord } from "../sheets";

export interface SearchMatchResult {
  exact: FilingRecord[];
  near: FilingRecord[];
}

/**
 * Splits a list of filings into exact-username matches and near (contains)
 * matches for the given query string. Matching is case-insensitive.
 * A record appears in exactly one bucket — exact takes priority.
 */
export function matchFilings(filings: FilingRecord[], query: string): SearchMatchResult {
  const q = query.toLowerCase();
  const exact = filings.filter((f) => f.username.toLowerCase() === q);
  const near = filings.filter(
    (f) => f.username.toLowerCase() !== q && f.username.toLowerCase().includes(q),
  );
  return { exact, near };
}
