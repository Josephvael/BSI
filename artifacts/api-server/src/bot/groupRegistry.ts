import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const FILE = "./.bot-data/groups.json";

export interface RegisteredGroup {
  id: number;
  label: string;
  addedBy: string;
  addedAt: string;
}

async function load(): Promise<RegisteredGroup[]> {
  if (!existsSync(FILE)) return [];
  const raw = await readFile(FILE, "utf-8");
  return JSON.parse(raw) as RegisteredGroup[];
}

async function save(groups: RegisteredGroup[]): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(FILE, JSON.stringify(groups, null, 2));
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

  groups.push({ id, label, addedBy, addedAt: new Date().toISOString() });
  await save(groups);
  return { added: true };
}

export async function removeGroup(id: number): Promise<boolean> {
  const groups = await load();
  const next = groups.filter((g) => g.id !== id);
  if (next.length === groups.length) return false;
  await save(next);
  return true;
}
