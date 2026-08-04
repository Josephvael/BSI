/**
 * Pure header-migration logic, decoupled from the Sheets HTTP layer so it can
 * be unit-tested without network calls or Google credentials.
 *
 * Atomicity contract
 * ──────────────────
 * There is no separate clear step. Instead, `runHeaderMigration` issues a single
 * PUT to a range that spans max(oldRowCount, newRowCount). The Sheets API clears
 * cells inside the range that are not covered by the provided values, so excess
 * legacy rows are wiped as part of the same write. If the PUT fails, the sheet
 * is untouched — historical data is never lost.
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
 * Converts data rows (everything below the header) into the new 7-column
 * per-item format.
 *
 * - New-format rows (col A starts with "FID-") pass through unchanged.
 * - Old-format rows (5-column) are expanded — one row per seized item —
 *   grouped under a generated FID-legacy-XXXX Filing ID.
 * - Blank rows are dropped.
 */
export function transformDataRows(rows: string[][]): string[][] {
  const result: string[][] = [];
  let legacyIdx = 0;

  for (const row of rows) {
    if (!row.some((cell) => cell?.trim())) continue; // skip blank rows

    if (row[0]?.startsWith("FID-")) {
      result.push(row); // already new format
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
 * Old-header detection requires ALL five column names to match OLD_HEADER exactly —
 * not just the first column.  An unrecognised layout is never overwritten.
 *
 * On success, legacy data rows are also rewritten in the new per-item format so
 * Sheets formulas (=SUMIF, =SUM, pivot tables) work across all historical filings.
 *
 * The write is atomic with respect to data loss:
 *   • A single PUT covering max(oldRows, newRows) replaces all content in one call.
 *   • The Sheets API clears cells within the range that have no corresponding value,
 *     removing excess legacy rows without a separate clear request.
 *   • If the PUT fails, the original sheet is untouched.
 *
 * Outcome discriminants:
 *   "up-to-date"    — header matches NEW_HEADER exactly; no write issued
 *   "migrated"      — schema successfully upgraded
 *   "unknown-header"— unrecognised layout; caller must abort, not append
 *   "get-failed"    — Sheets GET returned non-OK; caller must abort
 *   "put-failed"    — Sheets PUT returned non-OK; original data intact; caller must abort
 */
export async function runHeaderMigration(
  sheetId: string,
  request: SheetRequestFn,
): Promise<MigrationResult> {
  // 1. Read ALL rows — needed both to inspect the header and to transform data
  const readRange = encodeURIComponent("Sheet1!A:G");
  const getRes = await request(`/v4/spreadsheets/${sheetId}/values/${readRange}`, { method: "GET" });
  if (!getRes.ok) return { outcome: "get-failed", status: getRes.status };

  const data = (await getRes.json()) as { values?: string[][] };
  const rows = data.values ?? [];
  const existingHeader = rows[0] ?? [];

  // 2. Already on new schema — every column must match exactly
  if (
    existingHeader.length === NEW_HEADER.length &&
    NEW_HEADER.every((col, i) => existingHeader[i] === col)
  ) {
    return { outcome: "up-to-date" };
  }

  // 3. Classify: empty sheet OR exact old schema OR unknown (all columns must match)
  const isEmpty = existingHeader.length === 0;
  const isOldSchema =
    !isEmpty &&
    existingHeader.length === OLD_HEADER.length &&
    OLD_HEADER.every((col, i) => existingHeader[i] === col);

  if (!isEmpty && !isOldSchema) {
    return { outcome: "unknown-header", existingHeader };
  }

  // 4. Transform data rows to the new per-item format
  const dataRows = rows.slice(1);
  const newDataRows = transformDataRows(dataRows);
  const nonBlankOld = dataRows.filter((r) => r.some((c) => c?.trim())).length;

  // 5. Atomic overwrite: use a PUT range spanning max(old, new) row count so:
  //    - All new rows are written
  //    - Cells in range beyond the new data are cleared by the Sheets API in the
  //      same request — no separate clear needed, no data loss if PUT fails
  const allRows: string[][] = [[...NEW_HEADER], ...newDataRows];
  const rowSpan = Math.max(rows.length, allRows.length);
  const writeRange = encodeURIComponent(`Sheet1!A1:G${rowSpan}`);

  const putRes = await request(
    `/v4/spreadsheets/${sheetId}/values/${writeRange}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: allRows }) },
  );
  if (!putRes.ok) {
    const body = await putRes.text();
    return { outcome: "put-failed", status: putRes.status, body };
  }

  return { outcome: "migrated", rowsTransformed: nonBlankOld };
}
