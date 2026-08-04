import { describe, it, expect } from "vitest";
import { runHeaderMigration, OLD_HEADER, NEW_HEADER, type MigrationResponse } from "./sheet-header-migration";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeResp(ok: boolean, status: number, body: unknown): MigrationResponse {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runHeaderMigration", () => {
  it("returns 'up-to-date' when row 1 already has the new 7-column header", async () => {
    const req = async () => makeResp(true, 200, { values: [NEW_HEADER] });
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("up-to-date");
  });

  it("detects old 5-column header, PUTs the new header, and returns 'migrated'", async () => {
    let putPath = "";
    let putPayload: unknown = null;

    const req = async (path: string, options?: RequestInit) => {
      if (options?.method !== "PUT") return makeResp(true, 200, { values: [OLD_HEADER] });
      putPath = path;
      putPayload = options.body ? JSON.parse(options.body as string) : null;
      return makeResp(true, 200, {});
    };

    const result = await runHeaderMigration("sheet-1", req);

    expect(result.outcome).toBe("migrated");
    expect(putPath).toContain("Sheet1");
    expect((putPayload as { values: string[][] }).values[0]).toEqual([...NEW_HEADER]);
  });

  it("treats an empty sheet (no header) as old-schema and migrates it", async () => {
    const req = async (path: string, options?: RequestInit) => {
      if (options?.method !== "PUT") return makeResp(true, 200, {}); // no 'values' key
      return makeResp(true, 200, {});
    };
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("migrated");
  });

  it("returns 'get-failed' and never calls PUT when the GET fails", async () => {
    let putCalled = false;
    const req = async (path: string, options?: RequestInit) => {
      if (options?.method === "PUT") putCalled = true;
      return makeResp(false, 503, "Service Unavailable");
    };
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("get-failed");
    expect((result as { status: number }).status).toBe(503);
    expect(putCalled).toBe(false);
  });

  it("returns 'put-failed' when GET succeeds but PUT returns a non-OK response", async () => {
    const req = async (path: string, options?: RequestInit) => {
      if (options?.method !== "PUT") return makeResp(true, 200, { values: [OLD_HEADER] });
      return makeResp(false, 429, "Rate limit exceeded");
    };
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("put-failed");
    expect((result as { status: number }).status).toBe(429);
    expect((result as { body: string }).body).toContain("Rate limit");
  });

  it("returns 'unknown-header' for a custom column layout without calling PUT", async () => {
    let putCalled = false;
    const req = async (path: string, options?: RequestInit) => {
      if (options?.method === "PUT") putCalled = true;
      return makeResp(true, 200, { values: [["Custom", "Column", "Names"]] });
    };
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("unknown-header");
    expect(putCalled).toBe(false);
    expect((result as { existingHeader: string[] }).existingHeader).toEqual(["Custom", "Column", "Names"]);
  });

  it("returns 'unknown-header' (not 'up-to-date') when only the first column matches NEW_HEADER", async () => {
    // Simulates a partially migrated or corrupted sheet where Filing ID is in col A
    // but the rest of the columns are wrong — must NOT be accepted as up-to-date.
    const partialHeader = ["Filing ID", "Wrong Col B", "Wrong Col C"];
    const req = async () => makeResp(true, 200, { values: [partialHeader] });
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("unknown-header");
  });

  it("returns 'unknown-header' when new header has correct columns but one is corrupted", async () => {
    const corruptHeader = [...NEW_HEADER] as string[];
    corruptHeader[3] = "CORRUPTED";  // "Item Seized" replaced
    const req = async () => makeResp(true, 200, { values: [corruptHeader] });
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("unknown-header");
  });

  it("returns 'up-to-date' only when every column of NEW_HEADER matches exactly", async () => {
    const req = async () => makeResp(true, 200, { values: [[...NEW_HEADER]] });
    const result = await runHeaderMigration("sheet-1", req);
    expect(result.outcome).toBe("up-to-date");
  });
});
