import { describe, it, expect } from "vitest";
import { matchFilings } from "./search-match";
import type { FilingRecord } from "../sheets";

function rec(username: string): FilingRecord {
  return { username, dateOfIncident: "2024-01-01", seized: "", discordUserAndId: "", timestamp: "" };
}

describe("matchFilings", () => {
  it("returns only exact matches when the query matches one username exactly", () => {
    const { exact, near } = matchFilings([rec("JohnDoe"), rec("JaneSmith")], "JohnDoe");
    expect(exact).toHaveLength(1);
    expect(exact[0].username).toBe("JohnDoe");
    expect(near).toHaveLength(0);
  });

  it("returns only near-matches when the query is a substring but not an exact match", () => {
    const { exact, near } = matchFilings([rec("JohnDoeJr"), rec("JaneSmith")], "JohnDoe");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(1);
    expect(near[0].username).toBe("JohnDoeJr");
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
    const { exact, near } = matchFilings([rec("JohnDoe"), rec("JaneSmith")], "Nobody");
    expect(exact).toHaveLength(0);
    expect(near).toHaveLength(0);
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
});
