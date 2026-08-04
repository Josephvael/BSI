import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type GuildMemberRoleManager,
} from "discord.js";

const ACCESS_FILE = "./.bot-data/access.json";

export type AccessibleInteraction = ChatInputCommandInteraction | ButtonInteraction;

// In-memory cache — invalidated on every write
let rolesCache: Set<string> | null = null;

async function loadRoles(): Promise<Set<string>> {
  if (rolesCache) return rolesCache;
  if (!existsSync(ACCESS_FILE)) {
    rolesCache = new Set();
    return rolesCache;
  }
  try {
    const raw = await readFile(ACCESS_FILE, "utf-8");
    const data = JSON.parse(raw) as { roles?: string[] };
    rolesCache = new Set(data.roles ?? []);
  } catch {
    rolesCache = new Set();
  }
  return rolesCache;
}

async function saveRoles(roles: Set<string>): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(ACCESS_FILE, JSON.stringify({ roles: [...roles] }, null, 2));
  rolesCache = roles;
}

export async function grantRoleAccess(roleId: string): Promise<void> {
  const roles = await loadRoles();
  roles.add(roleId);
  await saveRoles(roles);
}

export async function revokeRoleAccess(roleId: string): Promise<void> {
  const roles = await loadRoles();
  roles.delete(roleId);
  await saveRoles(roles);
}

export async function getAllowedRoles(): Promise<Set<string>> {
  return loadRoles();
}

/**
 * Returns true if the member is a server admin OR has at least one allowed role.
 */
export function checkAccess(
  interaction: AccessibleInteraction,
  allowedRoles: Set<string>,
): boolean {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  const memberRoles = interaction.member?.roles;
  if (!memberRoles) return false;

  if (Array.isArray(memberRoles)) {
    return (memberRoles as string[]).some((id) => allowedRoles.has(id));
  }

  return [...allowedRoles].some((id) => (memberRoles as GuildMemberRoleManager).cache.has(id));
}
