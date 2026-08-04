/**
 * Roblox API helpers — all public endpoints, no API key required.
 */
import { logger } from "../lib/logger";

const BASE_USERS = "https://users.roblox.com";
const BASE_THUMBNAILS = "https://thumbnails.roblox.com";
const BASE_GROUPS = "https://groups.roblox.com";

export interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
  description: string;
  created: string;
  isBanned: boolean;
}

export interface RobloxGroupRole {
  group: {
    id: number;
    name: string;
    memberCount: number;
  };
  role: {
    id: number;
    name: string;
    rank: number;
  };
}

export async function getUserByUsername(username: string): Promise<RobloxUser | null> {
  const res = await fetch(`${BASE_USERS}/v1/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });

  if (!res.ok) {
    logger.warn({ status: res.status, username }, "Roblox username lookup failed");
    return null;
  }

  const data = (await res.json()) as { data: { id: number; name: string; displayName: string }[] };
  if (!data.data.length) return null;

  // Second call needed for full profile (description, created, isBanned)
  return getUserById(data.data[0].id);
}

export async function getUserById(userId: number): Promise<RobloxUser | null> {
  const res = await fetch(`${BASE_USERS}/v1/users/${userId}`);
  if (!res.ok) {
    logger.warn({ status: res.status, userId }, "Roblox user lookup by ID failed");
    return null;
  }
  return res.json() as Promise<RobloxUser>;
}

export async function getAvatarUrl(userId: number): Promise<string | null> {
  const res = await fetch(
    `${BASE_THUMBNAILS}/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`,
  );
  if (!res.ok) {
    logger.warn({ status: res.status, userId }, "Roblox avatar fetch failed");
    return null;
  }
  const data = (await res.json()) as { data: { imageUrl: string }[] };
  return data.data[0]?.imageUrl ?? null;
}

export async function getUserGroups(userId: number): Promise<RobloxGroupRole[]> {
  const res = await fetch(`${BASE_GROUPS}/v1/users/${userId}/groups/roles`);
  if (!res.ok) {
    logger.warn({ status: res.status, userId }, "Roblox group roles fetch failed");
    return [];
  }
  const data = (await res.json()) as { data: RobloxGroupRole[] };
  return data.data ?? [];
}

export async function checkGroupMembership(
  userId: number,
  groupId: number,
): Promise<RobloxGroupRole | null> {
  const groups = await getUserGroups(userId);
  return groups.find((g) => g.group.id === groupId) ?? null;
}

export function profileUrl(userId: number): string {
  return `https://www.roblox.com/users/${userId}/profile`;
}
