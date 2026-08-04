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
  | { outcome: "migrated" }
  | { outcome: "unknown-header"; existingHeader: string[] }
  | { outcome: "get-failed"; status: number }
  | { outcome: "put-failed"; status: number; body: string };

/** Minimal subset of the fetch Response that the migration needs. */
export interface MigrationResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type SheetRequestFn = (path: string, options?: RequestInit) => Promise<MigrationResponse>;

/**
 * Reads row 1 of Sheet1 and upgrades it from the old 5-column header to the
 * new 7-column header when needed.
 *
 * Returns a discriminated union so callers can decide how to handle each case:
 *   "up-to-date"      — header is already 7-column; safe to proceed
 *   "migrated"        — successfully upgraded from 5-column; safe to proceed
 *   "unknown-header"  — unrecognised layout; left unchanged
 *   "get-failed"      — Sheets API returned non-OK on the read; caller should abort
 *   "put-failed"      — Sheets API returned non-OK on the write; caller should abort
 */
export async function runHeaderMigration(
  sheetId: string,
  request: SheetRequestFn,
): Promise<MigrationResult> {
  const range = encodeURIComponent("Sheet1!A1:G1");

  // ── 1. Read the current header ─────────────────────────────────────────────
  const getRes = await request(`/v4/spreadsheets/${sheetId}/values/${range}`, { method: "GET" });
  if (!getRes.ok) {
    return { outcome: "get-failed", status: getRes.status };
  }

  const data = (await getRes.json()) as { values?: string[][] };
  const existingHeader = data.values?.[0] ?? [];

  // ── 2. Already on new schema ───────────────────────────────────────────────
  if (existingHeader[0] === NEW_HEADER[0]) {
    return { outcome: "up-to-date" };
  }

  // ── 3. Detect old 5-column schema (or blank sheet) ─────────────────────────
  const isOldSchema =
    existingHeader.length === 0 ||
    (existingHeader[0] === OLD_HEADER[0] && existingHeader.length <= OLD_HEADER.length);

  if (!isOldSchema) {
    return { outcome: "unknown-header", existingHeader };
  }

  // ── 4. Write the new header ────────────────────────────────────────────────
  const putRes = await request(
    `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [NEW_HEADER] }) },
  );

  if (!putRes.ok) {
    const body = await putRes.text();
    return { outcome: "put-failed", status: putRes.status, body };
  }

  return { outcome: "migrated" };
}
