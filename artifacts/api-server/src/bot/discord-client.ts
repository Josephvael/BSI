/**
 * Lightweight singleton that makes the Discord.js Client available to modules
 * that aren't part of the interaction handler chain (e.g. spike-detector alerts).
 *
 * Usage:
 *   // In index.ts after client.login():
 *   setDiscordClient(client);
 *
 *   // Anywhere else:
 *   const client = getDiscordClient();
 *   if (client) await client.channels.fetch(channelId);
 */
import type { Client } from "discord.js";

let _client: Client | null = null;

export function setDiscordClient(client: Client): void {
  _client = client;
}

export function getDiscordClient(): Client | null {
  return _client;
}
