/**
 * Stores Discord user ID <-> Roblox user ID mappings in .bot-data/verifications.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

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
    cache = {};
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
