import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

const ACCESS_FILE = "./.bot-data/access.json";

async function loadUsers(): Promise<Set<string>> {
  if (!existsSync(ACCESS_FILE)) return new Set();
  const raw = await readFile(ACCESS_FILE, "utf-8");
  const data = JSON.parse(raw) as { users: string[] };
  return new Set(data.users);
}

async function saveUsers(users: Set<string>): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(ACCESS_FILE, JSON.stringify({ users: [...users] }, null, 2));
}

export async function grantAccess(userId: string): Promise<void> {
  const users = await loadUsers();
  users.add(userId);
  await saveUsers(users);
}

export async function revokeAccess(userId: string): Promise<void> {
  const users = await loadUsers();
  users.delete(userId);
  await saveUsers(users);
}

export async function getAllowedUsers(): Promise<Set<string>> {
  return loadUsers();
}

/** Returns true if the user is an admin OR has been explicitly granted access. */
export function checkAccess(interaction: ChatInputCommandInteraction, allowedUsers: Set<string>): boolean {
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  return isAdmin || allowedUsers.has(interaction.user.id);
}
