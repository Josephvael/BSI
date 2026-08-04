import { describe, it, expect } from "vitest";
import {
  runHeaderMigration, transformDataRows,
  OLD_HEADER, NEW_HEADER,
  type MigrationResponse, type SheetRequestFn,
} from "./sheet-header-migration";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResp(ok: boolean, status: number, body: unknown): MigrationResponse {
  return {
    ok, status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/**
 * Models the same in-flight promise lock used in sheets.ts so concurrency
 * behaviour can be tested against the pure runHeaderMigration function.
 */
function createLockedRunner(reqFn: SheetRequestFn) {
  let migrated = false;
  let inFlight: Promise<void> | null = null;

  return async function runOnce(sheetId: string): Promise<void> {
    if (migrated) return;
    if (inFlight) { await inFlight; return; }

    inFlight = runHeaderMigration(sheetId, reqFn).then((result) => {
      if (result.outcome === "up-to-date" || result.outcome === "migrated") {
        migrated = true;
      } else {
        throw new Error(`migration failed: ${result.outcome}`);
      }
    });

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };
}

// ─── transformDataRows ────────────────────────────────────────────────────────

describe("transformDataRows", () => {
  it("passes new-format rows (FID- prefix) through unchanged", () => {
    const row = ["FID-abc", "JohnDoe", "2024-01-15", "Hawthorn M80A1", "2", "staff#1", "ts"];
    expect(transformDataRows([row])).toEqual([row]);
  });

  it("expands old-format seized string into multiple per-item rows sharing one Filing ID", () => {
    const row = ["JohnDoe", "2024-01-15", "2x Hawthorn M80A1, 1x Delino R20", "staff#1", "ts"];
    const result = transformDataRows([row]);
    expect(result).toHaveLength(2);
    expect(result[0][0]).toMatch(/^FID-legacy-/);
    expect(result[0][3]).toBe("Hawthorn M80A1");
    expect(result[0][4]).toBe("2");
    expect(result[1][3]).toBe("Delino R20");
    expect(result[1][4]).toBe("1");
    expect(result[0][0]).toBe(result[1][0]); // same Filing ID
  });

  it("writes one row with empty item/qty for a filing with no seizure", () => {
    const row = ["JohnDoe", "2024-01-15", "", "staff#1", "ts"];
    const [out] = transformDataRows([row]);
    expect(out[3]).toBe("");
    expect(out[4]).toBe("");
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
    expect(transformDataRows(rows)).toHaveLength(1);
  });
});

// ─── runHeaderMigration ───────────────────────────────────────────────────────

describe("runHeaderMigration", () => {
  // ── Up-to-date ────────────────────────────────────────────────────────────

  it("returns 'up-to-date' when every column of NEW_HEADER matches exactly", async () => {
    const req = async () => makeResp(true, 200, { values: [[...NEW_HEADER]] });
    expect((await runHeaderMigration("s", req)).outcome).toBe("up-to-date");
  });

  it("returns 'up-to-date' without issuing a PUT when schema is current", async () => {
    let putCalled = false;
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") putCalled = true;
      return makeResp(true, 200, { values: [[...NEW_HEADER]] });
    };
    await runHeaderMigration("s", req);
    expect(putCalled).toBe(false);
  });

  // ── Unknown-header (append must be blocked) ───────────────────────────────

  it("returns 'unknown-header' when only column A matches NEW_HEADER (partial/corrupt)", async () => {
    const partial = ["Filing ID", "Wrong B", "Wrong C"];
    const req = async () => makeResp(true, 200, { values: [partial] });
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("unknown-header");
    expect((result as { existingHeader: string[] }).existingHeader).toEqual(partial);
  });

  it("returns 'unknown-header' when one NEW_HEADER column is corrupted", async () => {
    const corrupt = [...NEW_HEADER] as string[];
    corrupt[3] = "CORRUPTED";
    const req = async () => makeResp(true, 200, { values: [corrupt] });
    expect((await runHeaderMigration("s", req)).outcome).toBe("unknown-header");
  });

  it("returns 'unknown-header' for a custom layout without issuing a PUT", async () => {
    let putCalled = false;
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") putCalled = true;
      return makeResp(true, 200, { values: [["Custom", "Columns"]] });
    };
    expect((await runHeaderMigration("s", req)).outcome).toBe("unknown-header");
    expect(putCalled).toBe(false);
  });

  it("returns 'unknown-header' for an old-prefix header whose remaining columns are wrong", async () => {
    const corrupted = ["Offender's Username", "WRONG", "WRONG", "WRONG", "WRONG"];
    const req = async () => makeResp(true, 200, { values: [corrupted] });
    expect((await runHeaderMigration("s", req)).outcome).toBe("unknown-header");
  });

  // ── Migration success ─────────────────────────────────────────────────────

  it("migrates old header with no data: writes new header only", async () => {
    let putValues: unknown = null;
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") { putValues = JSON.parse(opts.body as string); return makeResp(true, 200, {}); }
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("migrated");
    const { values } = putValues as { values: string[][] };
    expect(values[0]).toEqual([...NEW_HEADER]);
    expect(values).toHaveLength(1);
  });

  it("migrates old header with legacy data rows and expands them to per-item format", async () => {
    let putValues: unknown = null;
    const oldSheet = [
      [...OLD_HEADER],
      ["JohnDoe", "2024-01-15", "2x Hawthorn M80A1, 1x Delino R20", "staff#1234", "ts"],
    ];
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") { putValues = JSON.parse(opts.body as string); return makeResp(true, 200, {}); }
      return makeResp(true, 200, { values: oldSheet });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("migrated");
    const { values } = putValues as { values: string[][] };
    expect(values[0]).toEqual([...NEW_HEADER]);
    expect(values).toHaveLength(3); // header + 2 items
    expect(values[1][3]).toBe("Hawthorn M80A1");
    expect(values[1][4]).toBe("2");
    expect(values[2][3]).toBe("Delino R20");
    expect(values[2][4]).toBe("1");
  });

  it("treats an empty sheet as needing migration and writes the new header", async () => {
    let putValues: unknown = null;
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") { putValues = JSON.parse(opts.body as string); return makeResp(true, 200, {}); }
      return makeResp(true, 200, {}); // no 'values' key
    };
    expect((await runHeaderMigration("s", req)).outcome).toBe("migrated");
    expect((putValues as { values: string[][] }).values[0]).toEqual([...NEW_HEADER]);
  });

  it("PUT range spans max(old row count, new row count) so excess legacy rows are cleared atomically", async () => {
    let putPath = "";
    // 3 old data rows → 6 new rows after expansion (2 items each)
    const oldSheet = [
      [...OLD_HEADER],
      ["U1", "d1", "2x Item A, 2x Item B", "disc1", "ts1"],
      ["U2", "d2", "2x Item C, 2x Item D", "disc2", "ts2"],
      ["U3", "d3", "2x Item E, 2x Item F", "disc3", "ts3"],
    ];
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") { putPath = path; return makeResp(true, 200, {}); }
      return makeResp(true, 200, { values: oldSheet });
    };
    await runHeaderMigration("s", req);
    // new content = 1 header + 6 item rows = 7 rows; old = 4 rows; max = 7
    expect(decodeURIComponent(putPath)).toContain("Sheet1!A1:G7");
  });

  // ── Atomicity: no data loss on failure ────────────────────────────────────

  it("never issues a separate clear — PUT failure leaves original sheet data intact", async () => {
    const calls: string[] = [];
    const req = async (path: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      calls.push(method === "PUT" ? "PUT" : path.includes(":clear") ? "CLEAR" : "GET");
      if (opts?.method === "PUT") return makeResp(false, 429, "Rate limited");
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("put-failed");
    expect(calls).not.toContain("CLEAR"); // no destructive clear was issued
    expect(calls).toContain("GET");       // sheet was read
    expect(calls).toContain("PUT");       // write was attempted
  });

  // ── API failure paths ─────────────────────────────────────────────────────

  it("returns 'get-failed' and never calls PUT when GET fails", async () => {
    let putCalled = false;
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") putCalled = true;
      return makeResp(false, 503, "Service Unavailable");
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("get-failed");
    expect((result as { status: number }).status).toBe(503);
    expect(putCalled).toBe(false);
  });

  it("returns 'put-failed' when PUT fails after detecting old header", async () => {
    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") return makeResp(false, 429, "Rate limit exceeded");
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };
    const result = await runHeaderMigration("s", req);
    expect(result.outcome).toBe("put-failed");
    expect((result as { status: number }).status).toBe(429);
  });

  // ── Concurrency lock ──────────────────────────────────────────────────────

  it("concurrent migration calls: only one GET+PUT executes; second awaits the first", async () => {
    let getCallCount = 0;
    let putCallCount = 0;

    // Gate that lets us control when the GET resolves, ensuring both calls are
    // in-flight before the first one completes.
    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });

    const req = async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PUT") { putCallCount++; return makeResp(true, 200, {}); }
      getCallCount++;
      await getGate;
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };

    const runner = createLockedRunner(req);

    // Launch both calls before releasing the GET gate
    const p1 = runner("s");
    const p2 = runner("s");
    releaseGet();

    await Promise.all([p1, p2]);

    expect(getCallCount).toBe(1); // only one real migration ran
    expect(putCallCount).toBe(1);
  });

  it("concurrent calls after successful migration: all subsequent calls short-circuit", async () => {
    let callCount = 0;
    const req = async (path: string, opts?: RequestInit) => {
      callCount++;
      if (opts?.method === "PUT") return makeResp(true, 200, {});
      return makeResp(true, 200, { values: [[...OLD_HEADER]] });
    };

    const runner = createLockedRunner(req);
    await runner("s");            // first call — runs migration
    await runner("s");            // second call — should short-circuit (migrated = true)
    await runner("s");            // third call — should short-circuit

    // Only the original GET+PUT for the first migration should have been issued
    expect(callCount).toBe(2);    // 1 GET + 1 PUT
  });
});
