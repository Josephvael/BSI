import { describe, it, expect } from "vitest";
import {
  runHeaderMigration, transformDataRows,
  OLD_HEADER, NEW_HEADER,
  type MigrationResponse,
} from "./sheet-header-migration";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResp(ok: boolean, status: number, body: unknown): MigrationResponse {
  return {
    ok, status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// ─── transformDataRows ────────────────────────────────────────────────────────

describe("transformDataRows", () => {
  it("passes new-format rows (FID- prefix) through unchanged", () => {
    const row = ["FID-abc", "JohnDoe", "2024-01-15", "Hawthorn M80A1", "2", "staff#1", "ts"];
    expect(transformDataRows([row])).toEqual([row]);
  });

  it("expands old-format seized string into multiple per-item rows", () => {
    const row = ["JohnDoe", "2024-01-15", "2x Hawthorn M80A1, 1x Delino R20", "staff#1", "ts"];
    const result = transformDataRows([row]);
    expect(result).toHaveLength(2);
    expect(result[0][0]).toMatch(/^FID-legacy-/);
    expect(result[0][3]).toBe("Hawthorn M80A1");
    expect(result[0][4]).toBe("2");
    expect(result[1][3]).toBe("Delino R20");
    expect(result[1][4]).toBe("1");
    // Both items share the same Filing ID
    expect(result[0][0]).toBe(result[1][0]);
  });

  it("writes one row with empty item/qty for a filing with no seizure", () => {
    const row = ["JohnDoe", "2024-01-15", "", "staff#1", "ts"];
    const result = transformDataRows([row]);
    expect(result).toHaveLength(1);
    expect(result[0][3]).toBe("");
    expect(result[0][4]).toBe("");
  });

  it("assigns unique FID-legacy-XXXX IDs to each distinct legacy filing", () => {
    const rows = [
      ["User1", "2024-01-15", "1x Item", "staff#1", "ts1"],
      ["User2", "2024-01-16", "1x Item", "staff#1", "ts2"],
    ];
    const result = transformDataRows(rows);
    expect(result[0][0]).toBe("FID-legacy-0000");
    expect(result[1][0]).toBe("FID-legacy-0001");
  });

  it("skips blank rows", () => {
    const rows = [["", "", "", "", ""], ["User1", "2024-01-15", "", "staff#1", "ts"]];
    const result = transformDataRows(rows);
    expect(result).toHaveLength(1);
  });
});

// ─── runHeaderMigration ───────────────────────────────────────────────────────

describe("runHeaderMigration", () => {
  // ── Up-to-date ───────────────────────────────────────────────────────────────

  it("returns 'up-to-date' when every column of NEW_HEADER matches exactly", async () => {
    const req = async () => makeResp(true, 200, { values: [[...NEW_HEADER]] });
    expect((await runHeaderMigration("s", req)).outcome).toBe("up-to-date");
  });

  // ── Unknown-header (append must be blocked) ───────────────────────────────────

  it("returns 'unknown-header' when only column A matches NEW_HEADER (partial/corrupt)", async () => {
    const partial = ["Filing ID", "Wrong B", "Wrong C"];
    const req = async () => makeResp(true, 200, { values: [partial] });
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("unknown-header");
    expect((result as { existingHeader: string[] }).existingHeader).toEqual(partial);
  });

  it("returns 'unknown-header' when one column inside NEW_HEADER is corrupted", async () => {
    const corrupt = [...NEW_HEADER] as string[];
    corrupt[3] = "CORRUPTED";
    const req = async () => makeResp(true, 200, { values: [corrupt] });
    expect((await runHeaderMigration("s", req)).outcome).toBe("unknown-header");
  });

  it("returns 'unknown-header' for a custom layout and never calls clear or PUT", async () => {
    let clearCalled = false, putCalled = false;
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) clearCalled = true;
      if (opts?.method === "PUT") putCalled = true;
      return makeResp(true, 200, { values: [["Custom", "Columns"]] });
    };
    expect((await runHeaderMigration("s", req)).outcome).toBe("unknown-header");
    expect(clearCalled).toBe(false);
    expect(putCalled).toBe(false);
  });

  it("returns 'unknown-header' for an old-prefix header whose other columns are wrong", async () => {
    const corrupted = ["Offender's Username", "WRONG", "WRONG", "WRONG", "WRONG"];
    const req = async () => makeResp(true, 200, { values: [corrupted] });
    expect((await runHeaderMigration("s", req)).outcome).toBe("unknown-header");
  });

  // ── Migration success ─────────────────────────────────────────────────────────

  it("migrates old header with no data: clears and writes header only", async () => {
    let cleared = false;
    let putValues: unknown = null;
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) { cleared = true; return makeResp(true, 200, {}); }
      if (opts?.method === "PUT") { putValues = JSON.parse(opts.body as string); return makeResp(true, 200, {}); }
      return makeResp(true, 200, { values: [[...OLD_HEADER]] }); // GET: header only
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("migrated");
    expect(cleared).toBe(true);
    const { values } = putValues as { values: string[][] };
    expect(values[0]).toEqual([...NEW_HEADER]);
    expect(values).toHaveLength(1); // header row only
  });

  it("migrates old header with legacy data rows and transforms them to per-item format", async () => {
    let putValues: unknown = null;
    const oldSheet = [
      [...OLD_HEADER],
      ["JohnDoe", "2024-01-15", "2x Hawthorn M80A1, 1x Delino R20", "staff#1234", "ts"],
    ];
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) return makeResp(true, 200, {});
      if (opts?.method === "PUT") { putValues = JSON.parse(opts.body as string); return makeResp(true, 200, {}); }
      return makeResp(true, 200, { values: oldSheet });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("migrated");
    const { values } = putValues as { values: string[][] };
    // header + 2 per-item rows from the one legacy filing
    expect(values[0]).toEqual([...NEW_HEADER]);
    expect(values).toHaveLength(3);
    expect(values[1][3]).toBe("Hawthorn M80A1");
    expect(values[1][4]).toBe("2");
    expect(values[2][3]).toBe("Delino R20");
    expect(values[2][4]).toBe("1");
  });

  it("treats an empty sheet as needing migration and writes the new header", async () => {
    let putValues: unknown = null;
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) return makeResp(true, 200, {});
      if (opts?.method === "PUT") { putValues = JSON.parse(opts.body as string); return makeResp(true, 200, {}); }
      return makeResp(true, 200, {}); // no 'values' key
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("migrated");
    expect((putValues as { values: string[][] }).values[0]).toEqual([...NEW_HEADER]);
  });

  // ── API failure paths ─────────────────────────────────────────────────────────

  it("returns 'get-failed' and never calls clear or PUT when GET fails", async () => {
    let clearCalled = false, putCalled = false;
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) clearCalled = true;
      if (opts?.method === "PUT") putCalled = true;
      return makeResp(false, 503, "Service Unavailable");
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("get-failed");
    expect((result as { status: number }).status).toBe(503);
    expect(clearCalled).toBe(false);
    expect(putCalled).toBe(false);
  });

  it("returns 'clear-failed' and never calls PUT when clear fails", async () => {
    let putCalled = false;
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) return makeResp(false, 429, "Rate limit");
      if (opts?.method === "PUT") putCalled = true;
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("clear-failed");
    expect(putCalled).toBe(false);
  });

  it("returns 'put-failed' when PUT fails after a successful clear", async () => {
    const req = async (path: string, opts?: RequestInit) => {
      if (path.includes(":clear")) return makeResp(true, 200, {});
      if (opts?.method === "PUT") return makeResp(false, 429, "Rate limit exceeded");
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("put-failed");
    expect((result as { status: number }).status).toBe(429);
  });
});
