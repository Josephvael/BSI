import { ReplitConnectors } from "@replit/connectors-sdk";
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

let cachedSheetId: string | null = null;

async function getSheetId(): Promise<string> {
  if (cachedSheetId) return cachedSheetId;

  if (existsSync(SHEET_ID_FILE)) {
    const raw = await readFile(SHEET_ID_FILE, "utf-8");
    cachedSheetId = JSON.parse(raw).sheetId as string;
    return cachedSheetId;
  }

  return createSpreadsheet();
}

async function createSpreadsheet(): Promise<string> {
  const connectors = new ReplitConnectors();

  const createRes = await connectors.proxy("google-sheet", "/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "Discord Bot Filings" },
    }),
  });

  const createData = (await createRes.json()) as { spreadsheetId: string };
  const sheetId = createData.spreadsheetId;

  // Write header row
  const range = encodeURIComponent("Sheet1!A1:E1");
  await connectors.proxy(
    "google-sheet",
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
    { sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}` },
    "Created Google Sheet for bot filings",
  );

  return sheetId;
}

export async function appendFiling(record: FilingRecord): Promise<void> {
  const connectors = new ReplitConnectors();
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Sheet1!A:E");

  await connectors.proxy(
    "google-sheet",
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
}

export async function getFilings(): Promise<FilingRecord[]> {
  const connectors = new ReplitConnectors();
  const sheetId = await getSheetId();
  const range = encodeURIComponent("Sheet1!A:E");

  const res = await connectors.proxy(
    "google-sheet",
    `/v4/spreadsheets/${sheetId}/values/${range}`,
    { method: "GET" },
  );

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
