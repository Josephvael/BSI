import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { syncGroupsSheet, getGroupsFromSheet } from "./sheets";
import { logger } from "../lib/logger";

const FILE = "./.bot-data/groups.json";

export interface RegisteredGroup {
  id: number;
  label: string;
  addedBy: string;
  addedAt: string;
}

// In-memory cache — invalidated on every write
let cache: RegisteredGroup[] | null = null;

async function load(): Promise<RegisteredGroup[]> {
  if (cache) return cache;

  if (!existsSync(FILE)) {
    // Local file missing — attempt to restore from Google Sheets.
    // getGroupsFromSheet() throws on real API failures (auth, network, 5xx, etc.)
    // so the error propagates here and cache stays null. This prevents any
    // subsequent mutation from accidentally clearing Sheets data with an empty store.
    const restored = await getGroupsFromSheet();
    if (restored.length > 0) {
      logger.info(
        { count: restored.length },
        "Restored group registry from Google Sheet (local file was missing)",
      );
    }
    cache = restored;
    // Persist locally so future startups don't need the sheet
    await mkdir("./.bot-data", { recursive: true });
    await writeFile(FILE, JSON.stringify(cache, null, 2));
    return cache;
  }

  try {
    const raw = await readFile(FILE, "utf-8");
    cache = JSON.parse(raw) as RegisteredGroup[];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(groups: RegisteredGroup[]): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(FILE, JSON.stringify(groups, null, 2));
  cache = groups;
  // Await Sheets sync — errors propagate so callers know the backup failed
  await syncGroupsSheet(groups);
}

export async function getGroups(): Promise<RegisteredGroup[]> {
  return load();
}

export async function addGroup(
  id: number,
  label: string,
  addedBy: string,
): Promise<{ added: boolean; existing?: RegisteredGroup }> {
  const groups = await load();
  const existing = groups.find((g) => g.id === id);
  if (existing) return { added: false, existing };

  const updated = [...groups, { id, label, addedBy, addedAt: new Date().toISOString() }];
  await save(updated);
  return { added: true };
}

export async function removeGroup(id: number): Promise<boolean> {
  const groups = await load();
  const updated = groups.filter((g) => g.id !== id);
  if (updated.length === groups.length) return false;
  await save(updated);
  return true;
}

/**
 * Pushes the existing local group registry to Google Sheets.
 * Called once at startup so data is backed up even if no commands run
 * before the next restart. No-op if the local file does not exist yet.
 */
export async function syncGroupsToSheetsIfExists(): Promise<void> {
  if (!existsSync(FILE)) return;
  const groups = await load();
  await syncGroupsSheet(groups);
}
