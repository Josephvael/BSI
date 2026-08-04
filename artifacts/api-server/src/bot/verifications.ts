/**
 * Stores Discord user ID <-> Roblox user ID mappings in .bot-data/verifications.json
 * All writes are also synced to a "Verifications" tab in Google Sheets so data
 * survives a BisectHosting filesystem wipe.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { syncVerificationsSheet, getVerificationsFromSheet } from "./sheets";
import { logger } from "../lib/logger";

const FILE = "./.bot-data/verifications.json";

interface VerificationStore {
  [discordUserId: string]: {
    robloxId: number;
    robloxUsername: string;
    verifiedAt: string;
    verifiedBy: string;
  };
}

// In-memory cache — invalidated on every write
let cache: VerificationStore | null = null;

async function load(): Promise<VerificationStore> {
  if (cache) return cache;

  if (!existsSync(FILE)) {
    // Local file missing — attempt to restore from Google Sheets.
    // getVerificationsFromSheet() throws on real API failures (auth, network, 5xx, etc.)
    // so the error propagates here and cache stays null. This prevents any
    // subsequent mutation from accidentally clearing Sheets data with an empty store.
    const restored = await getVerificationsFromSheet();
    if (Object.keys(restored).length > 0) {
      logger.info(
        { count: Object.keys(restored).length },
        "Restored verifications from Google Sheet (local file was missing)",
      );
    }
    cache = restored as VerificationStore;
    // Persist locally so future startups don't need the sheet
    await mkdir("./.bot-data", { recursive: true });
    await writeFile(FILE, JSON.stringify(cache, null, 2));
    return cache;
  }

  try {
    const raw = await readFile(FILE, "utf-8");
    cache = JSON.parse(raw) as VerificationStore;
  } catch {
    cache = {};
  }
  return cache;
}

async function save(store: VerificationStore): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2));
  cache = store;
  // Await Sheets sync — errors propagate so callers know the backup failed
  await syncVerificationsSheet(store);
}

export async function setVerification(
  discordUserId: string,
  robloxId: number,
  robloxUsername: string,
  verifiedBy: string,
): Promise<void> {
  const store = await load();
  store[discordUserId] = {
    robloxId,
    robloxUsername,
    verifiedAt: new Date().toISOString(),
    verifiedBy,
  };
  await save(store);
}

export async function getVerification(discordUserId: string) {
  const store = await load();
  return store[discordUserId] ?? null;
}

export async function removeVerification(discordUserId: string): Promise<boolean> {
  const store = await load();
  if (!store[discordUserId]) return false;
  delete store[discordUserId];
  await save(store);
  return true;
}

/**
 * Pushes the existing local verification store to Google Sheets.
 * Called once at startup so data is backed up even if no commands run
 * before the next restart. No-op if the local file does not exist yet.
 */
export async function syncVerificationsToSheetsIfExists(): Promise<void> {
  if (!existsSync(FILE)) return;
  const store = await load();
  await syncVerificationsSheet(store);
}
