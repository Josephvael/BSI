/**
 * Pure header-migration logic, decoupled from the Sheets HTTP layer so it can
 * be unit-tested without network calls or Google credentials.
 */

export const OLD_HEADER = [
  "Offender's Username", "Date of Incident", "Seized", "Discord User + ID", "Timestamp",
] as const;

export const NEW_HEADER = [
  "Filing ID", "Offender's Username", "Date of Incident",
  "Item Seized", "Quantity", "Discord User + ID", "Timestamp",
] as const;

export type MigrationResult =
  | { outcome: "up-to-date" }
  | { outcome: "migrated"; rowsTransformed: number }
  | { outcome: "unknown-header"; existingHeader: string[] }
  | { outcome: "get-failed"; status: number }
  | { outcome: "clear-failed"; status: number }
  | { outcome: "put-failed"; status: number; body: string };

export interface MigrationResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type SheetRequestFn = (path: string, options?: RequestInit) => Promise<MigrationResponse>;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Parse "2x Item, 1x Item2" → [{name, qty}] */
function parseOldSeized(seized: string): { name: string; qty: number }[] {
  if (!seized?.trim() || seized.trim().toLowerCase() === "none") return [];
  const items: { name: string; qty: number }[] = [];
  for (const part of seized.split(",")) {
    const m = part.trim().match(/^(\d+)\s*x\s+(.+)$/i);
    if (m) items.push({ name: m[2].trim(), qty: parseInt(m[1], 10) });
    else if (part.trim()) items.push({ name: part.trim(), qty: 1 });
  }
  return items;
}

/**
 * Converts a list of raw sheet data rows (everything after the header) into
 * the new 7-column per-item format.
 *
 * - New-format rows (column A starts with "FID-") pass through unchanged.
 * - Old-format rows (5-column) are expanded: one row per seized item, with a
 *   generated FID-legacy-XXXX Filing ID grouping the items together.
 * - Blank rows are dropped.
 */
export function transformDataRows(rows: string[][]): string[][] {
  const result: string[][] = [];
  let legacyIdx = 0;

  for (const row of rows) {
    if (!row.some((cell) => cell?.trim())) continue; // skip blank rows

    if (row[0]?.startsWith("FID-")) {
      result.push(row); // already new format — pass through
    } else {
      const [username = "", date = "", seized = "", discord = "", timestamp = ""] = row;
      const filingId = `FID-legacy-${String(legacyIdx++).padStart(4, "0")}`;
      const items = parseOldSeized(seized);

      if (items.length === 0) {
        result.push([filingId, username, date, "", "", discord, timestamp]);
      } else {
        for (const item of items) {
          result.push([filingId, username, date, item.name, String(item.qty), discord, timestamp]);
        }
      }
    }
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the full Sheet1 content, determines the current schema, and migrates
 * it to the 7-column layout when safe to do so.
 *
 * The old header is accepted only when ALL five columns match OLD_HEADER exactly
 * (not just the first column).  An unknown layout is never overwritten.
 *
 * On success the old data rows are also rewritten in the new per-item format so
 * Sheets formulas (=SUMIF, =SUM, pivot tables) work across historical filings.
 *
 * Returns a discriminated union so the caller can decide how to handle each case:
 *   "up-to-date"    — header matches NEW_HEADER exactly; no work needed
 *   "migrated"      — schema successfully upgraded
 *   "unknown-header"— unrecognised layout; caller must abort rather than append
 *   "get-failed"    — Sheets GET returned non-OK; caller must abort
 *   "clear-failed"  — sheet clear returned non-OK; caller must abort
 *   "put-failed"    — Sheets PUT returned non-OK; caller must abort
 */
export async function runHeaderMigration(
  sheetId: string,
  request: SheetRequestFn,
): Promise<MigrationResult> {
  // 1. Read ALL rows so data can be transformed alongside the header
  const range = encodeURIComponent("Sheet1!A:G");
  const getRes = await request(`/v4/spreadsheets/${sheetId}/values/${range}`, { method: "GET" });
  if (!getRes.ok) return { outcome: "get-failed", status: getRes.status };

  const data = (await getRes.json()) as { values?: string[][] };
  const rows = data.values ?? [];
  const existingHeader = rows[0] ?? [];

  // 2. Already on new schema — every column must match exactly
  if (NEW_HEADER.every((col, i) => existingHeader[i] === col) && existingHeader.length === NEW_HEADER.length) {
    return { outcome: "up-to-date" };
  }

  // 3. Classify: empty sheet OR exact old schema OR unknown
  const isEmpty = existingHeader.length === 0;
  const isOldSchema =
    !isEmpty &&
    existingHeader.length === OLD_HEADER.length &&
    OLD_HEADER.every((col, i) => existingHeader[i] === col);

  if (!isEmpty && !isOldSchema) {
    return { outcome: "unknown-header", existingHeader };
  }

  // 4. Transform data rows (old-format → new per-item format; new rows pass through)
  const dataRows = rows.slice(1);
  const newDataRows = transformDataRows(dataRows);
  const nonBlankOld = dataRows.filter((r) => r.some((c) => c?.trim())).length;

  // 5. Clear the sheet so no old data remains under wrong headers
  const clearRes = await request(
    `/v4/spreadsheets/${sheetId}/values/${range}:clear`,
    { method: "POST" },
  );
  if (!clearRes.ok) return { outcome: "clear-failed", status: clearRes.status };

  // 6. Write new header + transformed rows in one PUT
  const allRows: string[][] = [[...NEW_HEADER], ...newDataRows];
  const putRes = await request(
    `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Sheet1!A1")}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: allRows }) },
  );
  if (!putRes.ok) {
    const body = await putRes.text();
    return { outcome: "put-failed", status: putRes.status, body };
  }

  return { outcome: "migrated", rowsTransformed: nonBlankOld };
}
