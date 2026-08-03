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
  timestamp: string;
  discordUser: string;
  username: string;
  licensePlate: string;
  profession: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedSheetId: string | null = null;

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
    const raw = await readFile(SHEET_ID_FILE, "utf-8");
    cachedSheetId = (JSON.parse(raw) as { sheetId: string }).sheetId;
    return cachedSheetId;
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

  // Write header row
  const range = encodeURIComponent("Sheet1!A1:E1");
  await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({
        values: [["Timestamp", "Discord User", "Username", "License Plate", "Possession"]],
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
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Sheet1!A:E");

  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      body: JSON.stringify({
        values: [[
          record.timestamp,
          record.discordUser,
          record.username,
          record.licensePlate,
          record.profession,
        ]],
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets append failed (${res.status}): ${err}`);
  }
}

export async function getFilings(): Promise<FilingRecord[]> {
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Sheet1!A:E");

  const res = await sheetsRequest(
    `/v4/spreadsheets/${sheetId}/values/${range}`,
    { method: "GET" },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets read failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values ?? [];

  // Skip header row
  return rows.slice(1).map((row) => ({
    timestamp: row[0] ?? "",
    discordUser: row[1] ?? "",
    username: row[2] ?? "",
    licensePlate: row[3] ?? "",
    profession: row[4] ?? "",
  }));
}

export async function getSheetUrl(): Promise<string> {
  const sheetId = await getSheetId();
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}
