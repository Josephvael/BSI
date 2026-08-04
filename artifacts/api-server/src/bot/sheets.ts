/**
 * Google Sheets integration using direct API calls with a Service Account.
 *
 * Required environment variable:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — the full contents of your service account key JSON file
 *
 * Optional environment variable:
 *   GOOGLE_SHEET_ID — if set, uses this existing spreadsheet instead of creating a new one
 *
 * How to set up:
 *   1. Go to console.cloud.google.com → IAM & Admin → Service Accounts → Create
 *   2. Enable the Google Sheets API for your project
 *   3. Download the JSON key for the service account
 *   4. Share your Google Sheet with the service account email (Editor access)
 *   5. Paste the full JSON contents as GOOGLE_SERVICE_ACCOUNT_JSON in BisectHosting env vars
 */
import { webcrypto } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { logger } from "../lib/logger";

const SHEET_ID_FILE = "./.bot-data/sheet-id.json";

export interface FilingRecord {
  username: string;
  dateOfIncident: string;
  seized: string;
  discordUserAndId: string;
  timestamp: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedSheetId: string | null = null;

/** TTL in milliseconds for the filings cache (default 60 s, override with FILINGS_CACHE_TTL_MS). */
const FILINGS_CACHE_TTL_MS = Number(process.env.FILINGS_CACHE_TTL_MS ?? 60_000);

interface FilingsCache {
  records: FilingRecord[];
  /** Unix timestamp (ms) when the data was fetched from Sheets. */
  fetchedAt: number;
}

let filingsCache: FilingsCache | null = null;

/**
 * Normalises a private key that may have been pasted with literal \n instead
 * of real newlines (common when copying from a JSON file into an env var field).
 */
function fixPrivateKey(key: string): string {
  // Replace any literal \n or \r\n sequences with real newlines
  let fixed = key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();

  // If the key body has no newlines at all, it was pasted as one line —
  // insert newlines every 64 chars between the header and footer.
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  if (fixed.includes(header) && !fixed.includes("\n")) {
    const body = fixed
      .replace(header, "")
      .replace(footer, "")
      .trim()
      .replace(/(.{64})/g, "$1\n");
    fixed = `${header}\n${body}\n${footer}`;
  }

  return fixed;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  let sa: ServiceAccount;

  // Prefer individual env vars (easier to paste into BisectHosting)
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    sa = { client_email: clientEmail, private_key: fixPrivateKey(privateKey) };
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
    sa.private_key = fixPrivateKey(sa.private_key);
  } else {
    throw new Error(
      "Google Sheets credentials not set. Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY " +
      "as environment variables in BisectHosting. Find these values in your service account JSON key file."
    );
  }

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");

  const sigInput = `${header}.${payload}`;

  // Import the key using Web Crypto (bypasses OpenSSL PEM decoder, works on Node 24)
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const keyBuffer = Buffer.from(pemBody, "base64");
  const cryptoKey = await webcrypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(sigInput),
  );
  const signature = Buffer.from(sigBuffer).toString("base64url");
  const jwt = `${sigInput}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) {
    throw new Error(`Failed to get Google access token: ${JSON.stringify(data)}`);
  }

  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return cachedToken.token;
}

async function sheetsRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://sheets.googleapis.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function getSheetId(): Promise<string> {
  if (cachedSheetId) return cachedSheetId;

  // Allow overriding with a specific sheet ID via env var
  if (process.env.GOOGLE_SHEET_ID) {
    cachedSheetId = process.env.GOOGLE_SHEET_ID;
    return cachedSheetId;
  }

  if (existsSync(SHEET_ID_FILE)) {
    try {
      const raw = await readFile(SHEET_ID_FILE, "utf-8");
      const parsed = JSON.parse(raw) as { sheetId?: string };
      if (parsed.sheetId) {
        cachedSheetId = parsed.sheetId;
        return cachedSheetId;
      }
    } catch {
      // Malformed file — fall through to create a new spreadsheet
    }
  }

  return createSpreadsheet();
}

async function createSpreadsheet(): Promise<string> {
  const res = await sheetsRequest("/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({ properties: { title: "Discord Bot Filings" } }),
  });

  const data = (await res.json()) as { spreadsheetId: string };
  const sheetId = data.spreadsheetId;

  // Write header row matching current FilingRecord column order
  const range = encodeURIComponent("Sheet1!A1:E1");
  await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({
        values: [["Offender's Username", "Date of Incident", "Seized", "Discord User + ID", "Timestamp"]],
      }),
    },
  );

  await mkdir("./.bot-data", { recursive: true });
  await writeFile(SHEET_ID_FILE, JSON.stringify({ sheetId }));

  cachedSheetId = sheetId;
  logger.info(
    `Created Google Sheet: https://docs.google.com/spreadsheets/d/${sheetId}`,
  );

  return sheetId;
}

export async function appendFiling(record: FilingRecord): Promise<void> {
  let sheetId = await getSheetId();
  const range = encodeURIComponent("Sheet1!A:E");
  const body = JSON.stringify({
    values: [[
      record.username,
      record.dateOfIncident,
      record.seized,
      record.discordUserAndId,
      record.timestamp,
    ]],
  });

  let res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
    { method: "POST", body },
  );

  // Stale sheet ID — create a fresh sheet and retry once
  if (res.status === 404) {
    cachedSheetId = null;
    await writeFile(SHEET_ID_FILE, JSON.stringify({ sheetId: "" })).catch((err) =>
      logger.warn({ err }, "Failed to clear cached sheet ID"),
    );
    sheetId = await createSpreadsheet();
    res = await sheetsRequest(
      `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Sheet1!A:E")}:append?valueInputOption=USER_ENTERED`,
      { method: "POST", body },
    );
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets append failed (${res.status}): ${err}`);
  }

  // Invalidate the filings cache so the next /search reflects the new entry
  filingsCache = null;
}

export interface FilingsResult {
  records: FilingRecord[];
  /** Unix timestamp (ms) when these records were fetched from Google Sheets. */
  fetchedAt: number;
}

export async function getFilings(): Promise<FilingsResult> {
  const now = Date.now();

  // Return cached data if it's still fresh
  if (filingsCache && now - filingsCache.fetchedAt < FILINGS_CACHE_TTL_MS) {
    return { records: filingsCache.records, fetchedAt: filingsCache.fetchedAt };
  }

  let sheetId = await getSheetId();
  const range = encodeURIComponent("Sheet1!A:E");

  let res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}`,
    { method: "GET" },
  );

  // If the cached sheet ID is stale (sheet was deleted or never existed),
  // clear it and create a fresh one.
  if (res.status === 404) {
    cachedSheetId = null;
    await writeFile(SHEET_ID_FILE, JSON.stringify({ sheetId: "" })).catch((err) =>
      logger.warn({ err }, "Failed to clear cached sheet ID"),
    );
    sheetId = await createSpreadsheet();
    res = await sheetsRequest(
      `/v4/spreadsheets/${sheetId}/values/${range}`,
      { method: "GET" },
    );
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets read failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values ?? [];

  // Skip header row — columns:
  // A: Username, B: Date of Incident, C: Seized, D: Discord User + ID, E: Timestamp
  const records: FilingRecord[] = rows.slice(1).map((row) => ({
    username: row[0] ?? "",
    dateOfIncident: row[1] ?? "",
    seized: row[2] ?? "",
    discordUserAndId: row[3] ?? "",
    timestamp: row[4] ?? "",
  }));

  const fetchedAt = Date.now();
  filingsCache = { records, fetchedAt };
  return { records, fetchedAt };
}

export async function getSheetUrl(): Promise<string> {
  const sheetId = await getSheetId();
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}

export interface GroupRecord {
  id: number;
  label: string;
  addedBy: string;
  addedAt: string;
}

/**
 * Writes all registered groups to a "Groups" tab in the same spreadsheet.
 * Creates the tab if it doesn't exist yet.
 */
export async function syncGroupsSheet(groups: GroupRecord[]): Promise<void> {
  const sheetId = await getSheetId();

  // Try to create the Groups tab — ignore error if it already exists
  await sheetsRequest(`/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: "Groups" } } }],
    }),
  });

  // Explicitly clear the tab first so removed rows don't linger
  await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Groups!A1:D")}:clear`,
    { method: "POST" },
  );

  // Rewrite the whole tab using RAW so numeric-looking IDs aren't mangled
  const range = encodeURIComponent("Groups!A1:D");
  const values: string[][] = [
    ["Group ID", "Label", "Added By", "Added At"],
    ...groups.map((g) => [String(g.id), g.label, g.addedBy, g.addedAt]),
  ];

  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values }) },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groups sheet sync failed (${res.status}): ${err}`);
  }
}

/**
 * Reads the "Groups" tab and returns the registered groups.
 * Returns an empty array only when the tab genuinely doesn't exist yet.
 * Throws on any other non-OK response so callers can distinguish a real API
 * failure from a legitimately empty tab.
 */
export async function getGroupsFromSheet(): Promise<GroupRecord[]> {
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Groups!A1:D");
  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}`,
    { method: "GET" },
  );
  if (!res.ok) {
    const body = await res.text();
    // 400 "Unable to parse range" means the tab hasn't been created yet — safe to treat as empty.
    if (res.status === 400 && body.includes("Unable to parse range")) return [];
    throw new Error(`Sheets read failed for Groups (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  const rows = (data.values ?? []).slice(1); // skip header
  return rows
    .filter((row) => row[0])
    .map((row) => ({
      id: Number(row[0]),
      label: row[1] ?? "",
      addedBy: row[2] ?? "",
      addedAt: row[3] ?? "",
    }));
}

/**
 * Writes all allowed role IDs to an "Access Roles" tab in the same spreadsheet.
 * Creates the tab if it doesn't exist yet.
 */
export async function syncAccessSheet(roles: string[]): Promise<void> {
  const sheetId = await getSheetId();

  // Try to create the tab — ignore error if it already exists
  await sheetsRequest(`/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: "Access Roles" } } }],
    }),
  });

  // Explicitly clear the tab first so revoked roles don't linger
  await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Access Roles!A1:A")}:clear`,
    { method: "POST" },
  );

  // Rewrite using RAW so Discord snowflake IDs (17–19 digits) are stored as
  // plain strings and not mangled by Sheets' numeric precision limit.
  const range = encodeURIComponent("Access Roles!A1:A");
  const values: string[][] = [
    ["Role ID"],
    ...roles.map((id) => [id]),
  ];

  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values }) },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Access Roles sheet sync failed (${res.status}): ${err}`);
  }
}

/**
 * Reads the "Access Roles" tab and returns the role IDs.
 * Returns an empty array only when the tab genuinely doesn't exist yet.
 * Throws on any other non-OK response so callers can distinguish a real API
 * failure from a legitimately empty tab.
 */
export async function getAccessFromSheet(): Promise<string[]> {
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Access Roles!A1:A");
  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}`,
    { method: "GET" },
  );
  if (!res.ok) {
    const body = await res.text();
    // 400 "Unable to parse range" means the tab hasn't been created yet — safe to treat as empty.
    if (res.status === 400 && body.includes("Unable to parse range")) return [];
    throw new Error(`Sheets read failed for Access Roles (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  const rows = (data.values ?? []).slice(1); // skip header
  return rows.filter((row) => row[0]).map((row) => row[0]);
}

export interface VerificationEntry {
  robloxId: number;
  robloxUsername: string;
  verifiedAt: string;
  verifiedBy: string;
}

/**
 * Writes all Discord↔Roblox verifications to a "Verifications" tab.
 * Creates the tab if it doesn't exist yet.
 */
export async function syncVerificationsSheet(
  store: Record<string, VerificationEntry>,
): Promise<void> {
  const sheetId = await getSheetId();

  // Try to create the tab — ignore error if it already exists
  await sheetsRequest(`/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: "Verifications" } } }],
    }),
  });

  // Explicitly clear the tab first so removed verifications don't linger
  await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Verifications!A1:E")}:clear`,
    { method: "POST" },
  );

  // Rewrite using RAW so Discord snowflake IDs (17–19 digits) are stored as
  // plain strings and not mangled by Sheets' numeric precision limit.
  const range = encodeURIComponent("Verifications!A1:E");
  const values: string[][] = [
    ["Discord User ID", "Roblox ID", "Roblox Username", "Verified At", "Verified By"],
    ...Object.entries(store).map(([discordId, v]) => [
      discordId,
      String(v.robloxId),
      v.robloxUsername,
      v.verifiedAt,
      v.verifiedBy,
    ]),
  ];

  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values }) },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Verifications sheet sync failed (${res.status}): ${err}`);
  }
}

/**
 * Reads the "Verifications" tab and returns the verification store.
 * Returns an empty object only when the tab genuinely doesn't exist yet.
 * Throws on any other non-OK response so callers can distinguish a real API
 * failure from a legitimately empty tab.
 */
export async function getVerificationsFromSheet(): Promise<Record<string, VerificationEntry>> {
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Verifications!A1:E");
  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}`,
    { method: "GET" },
  );
  if (!res.ok) {
    const body = await res.text();
    // 400 "Unable to parse range" means the tab hasn't been created yet — safe to treat as empty.
    if (res.status === 400 && body.includes("Unable to parse range")) return {};
    throw new Error(`Sheets read failed for Verifications (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  const rows = (data.values ?? []).slice(1); // skip header
  const store: Record<string, VerificationEntry> = {};
  for (const row of rows) {
    if (!row[0]) continue;
    store[row[0]] = {
      robloxId: Number(row[1]),
      robloxUsername: row[2] ?? "",
      verifiedAt: row[3] ?? "",
      verifiedBy: row[4] ?? "",
    };
  }
  return store;
}
