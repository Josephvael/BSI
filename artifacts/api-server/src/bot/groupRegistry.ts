import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { syncGroupsSheet } from "./sheets";
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
    cache = [];
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
  syncGroupsSheet(updated).catch((err) =>
    logger.warn({ err }, "Failed to sync groups to Google Sheet"),
  );
  return { added: true };
}

export async function removeGroup(id: number): Promise<boolean> {
  const groups = await load();
  const updated = groups.filter((g) => g.id !== id);
  if (updated.length === groups.length) return false;
  await save(updated);
  syncGroupsSheet(updated).catch((err) =>
    logger.warn({ err }, "Failed to sync groups to Google Sheet"),
  );
  return true;
}
