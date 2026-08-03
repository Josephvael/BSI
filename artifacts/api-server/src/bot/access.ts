import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type GuildMemberRoleManager,
} from "discord.js";

const ACCESS_FILE = "./.bot-data/access.json";

type AccessibleInteraction = ChatInputCommandInteraction | ButtonInteraction;

async function loadRoles(): Promise<Set<string>> {
  if (!existsSync(ACCESS_FILE)) return new Set();
  const raw = await readFile(ACCESS_FILE, "utf-8");
  const data = JSON.parse(raw) as { roles?: string[]; users?: string[] };
  // Support old user-based format gracefully
  return new Set(data.roles ?? data.users ?? []);
}

async function saveRoles(roles: Set<string>): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(ACCESS_FILE, JSON.stringify({ roles: [...roles] }, null, 2));
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
 * Returns true if the member is an admin OR has at least one of the allowed roles.
 */
export function checkAccess(
  interaction: AccessibleInteraction,
  allowedRoles: Set<string>,
): boolean {
  const isAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  if (isAdmin) return true;

  const memberRoles = interaction.member?.roles;
  if (!memberRoles) return false;

  // GuildMemberRoleManager has a .cache; a plain array of role IDs also works
  if (memberRoles instanceof Array) {
    return memberRoles.some((id) => allowedRoles.has(id as string));
  }

  const roleManager = memberRoles as GuildMemberRoleManager;
  return [...allowedRoles].some((id) => roleManager.cache.has(id));
}
