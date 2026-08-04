import { describe, it, expect } from "vitest";
import { matchFilings, levenshteinDistance } from "./search-match";
import type { FilingRecord } from "../sheets";

function rec(username: string): FilingRecord {
  return { username, dateOfIncident: "2024-01-01", seized: "", discordUserAndId: "", timestamp: "" };
}

describe("matchFilings", () => {
  it("returns only exact matches when the query matches one username exactly", () => {
    const { exact, near, fuzzy } = matchFilings([rec("JohnDoe"), rec("JaneSmith")], "JohnDoe");
    expect(exact).toHaveLength(1);
    expect(exact[0].username).toBe("JohnDoe");
    expect(near).toHaveLength(0);
    expect(fuzzy).toHaveLength(0);
  });

  it("returns only near-matches when the query is a substring but not an exact match", () => {
    const { exact, near, fuzzy } = matchFilings([rec("JohnDoeJr"), rec("JaneSmith")], "JohnDoe");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(1);
    expect(near[0].username).toBe("JohnDoeJr");
    expect(fuzzy).toHaveLength(0);
  });

  it("returns both exact and near-matches when both are present, exact first in their bucket", () => {
    const filings = [rec("JohnDoe"), rec("JohnDoeJr"), rec("JaneSmith")];
    const { exact, near } = matchFilings(filings, "JohnDoe");
    expect(exact).toHaveLength(1);
    expect(exact[0].username).toBe("JohnDoe");
    expect(near).toHaveLength(1);
    expect(near[0].username).toBe("JohnDoeJr");
  });

  it("returns empty buckets when there are no matches at all", () => {
    const { exact, near, fuzzy } = matchFilings([rec("JohnDoe"), rec("JaneSmith")], "Nobody");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(0);
    expect(fuzzy).toHaveLength(0);
  });

  it("exact matches do not bleed into the near-match bucket", () => {
    const filings = [rec("JohnDoe"), rec("JohnDoeSr"), rec("JohnDoeJr")];
    const { exact, near } = matchFilings(filings, "johndoe");
    expect(exact).toHaveLength(1);
    expect(near).toHaveLength(2);
    expect(near.map((f) => f.username.toLowerCase())).not.toContain("johndoe");
  });

  it("near-match records preserve the original stored username", () => {
    const { near } = matchFilings([rec("JohnDoe_2024")], "JohnDoe");
    expect(near).toHaveLength(1);
    // The stored-as username must be accessible so the embed can show it
    expect(near[0].username).toBe("JohnDoe_2024");
  });

  it("matching is case-insensitive for both exact and near buckets", () => {
    const filings = [rec("JOHNDOE"), rec("johndoeJR")];
    const { exact, near } = matchFilings(filings, "johndoe");
    expect(exact).toHaveLength(1);
    expect(exact[0].username).toBe("JOHNDOE");
    expect(near).toHaveLength(1);
    expect(near[0].username).toBe("johndoeJR");
  });

  it("a query that is a prefix of multiple usernames produces multiple near-matches", () => {
    const filings = [rec("Alpha1"), rec("Alpha2"), rec("Alpha3"), rec("Beta")];
    const { exact, near } = matchFilings(filings, "alpha");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(3);
  });

  // Fuzzy matching tests
  it("surfaces a single-character transposition as a fuzzy match (e.g. Xaenith vs Xenaith)", () => {
    const { exact, near, fuzzy } = matchFilings([rec("Xaenith")], "Xenaith");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(0);
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0].username).toBe("Xaenith");
  });

  it("surfaces a single-character substitution as a fuzzy match", () => {
    const { fuzzy } = matchFilings([rec("Xenaith"), rec("Zenaith")], "Xenaith");
    // Xenaith is exact; Zenaith is 1 substitution away — should be fuzzy
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0].username).toBe("Zenaith");
  });

  it("surfaces a single-character insertion as a fuzzy match", () => {
    const { exact, fuzzy } = matchFilings([rec("Xenaith"), rec("Xenaiths")], "Xenaith");
    // "Xenaiths" is 1 insertion away but also contains the query, so it lands in near not fuzzy
    expect(exact).toHaveLength(1);
    // near would catch "Xenaiths" via includes(); fuzzy should be empty
    const { near } = matchFilings([rec("Xenaith"), rec("Xenaiths")], "Xenaith");
    expect(near).toHaveLength(1);
    expect(near[0].username).toBe("Xenaiths");
    expect(fuzzy).toHaveLength(0);
  });

  it("surfaces a single-character deletion as a fuzzy match", () => {
    const { fuzzy } = matchFilings([rec("Xeaith")], "Xenaith");
    // "Xeaith" is 1 deletion away, and does not contain "xenaith" as substring
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0].username).toBe("Xeaith");
  });

  it("does not surface usernames beyond edit distance 2", () => {
    // "Abcdef" vs "Xyzabc" — edit distance well over 2
    const { exact, near, fuzzy } = matchFilings([rec("Abcdef")], "Xyzabc");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(0);
    expect(fuzzy).toHaveLength(0);
  });

  it("exact and near matches are excluded from the fuzzy bucket", () => {
    const filings = [rec("Xenaith"), rec("XenaithJr"), rec("Xeaith")];
    const { exact, near, fuzzy } = matchFilings(filings, "Xenaith");
    expect(exact.map((f) => f.username)).toContain("Xenaith");
    expect(near.map((f) => f.username)).toContain("XenaithJr");
    expect(fuzzy.map((f) => f.username)).toContain("Xeaith");
    // No overlap between buckets
    const allNames = [...exact, ...near, ...fuzzy].map((f) => f.username);
    expect(new Set(allNames).size).toBe(allNames.length);
  });

  it("fuzzy matching is case-insensitive", () => {
    const { fuzzy } = matchFilings([rec("XEAITH")], "Xenaith");
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0].username).toBe("XEAITH");
  });

  it("fuzzy match preserves the original stored username for display", () => {
    const { fuzzy } = matchFilings([rec("Xeaith")], "Xenaith");
    expect(fuzzy[0].username).toBe("Xeaith");
  });
});

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("returns the length of the string when comparing to empty string", () => {
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });

  it("counts a single substitution as distance 1", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
  });

  it("counts a single insertion as distance 1", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  it("counts a single deletion as distance 1", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("counts a transposition (swap of adjacent chars) as distance 2", () => {
    // Levenshtein treats a transposition as 2 operations (delete + insert)
    expect(levenshteinDistance("ab", "ba")).toBe(2);
  });
});
