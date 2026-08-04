/**
 * Standalone bot entry point — for BisectHosting and other Node.js hosts.
 * Runs only the Discord bot, no Express server.
 *
 * BisectHosting start command: node dist/bot-standalone.mjs
 *
 * Required environment variables:
 *   DISCORD_BOT_TOKEN
 *   DISCORD_CLIENT_ID
 *   DISCORD_GUILD_ID
 *   REPLIT_CONNECTORS_HOSTNAME  (set automatically by Replit; see BISECTHOSTING.md if hosting elsewhere)
 *   REPL_IDENTITY               (set automatically by Replit; see BISECTHOSTING.md if hosting elsewhere)
 *
 * Required for Google Sheets backup/restore to survive filesystem wipes:
 *   GOOGLE_SHEET_ID             — spreadsheet ID (must be a persistent env var, NOT stored on disk)
 *   GOOGLE_CLIENT_EMAIL         — service account email
 *   GOOGLE_PRIVATE_KEY          — service account private key
 */

import { startBot } from "./bot/index";
import { logger } from "./lib/logger";
import { syncAccessToSheetsIfExists } from "./bot/access";
import { syncVerificationsToSheetsIfExists } from "./bot/verifications";
import { syncGroupsToSheetsIfExists } from "./bot/groupRegistry";

// GOOGLE_SHEET_ID must be set as a persistent environment variable on the host.
// The .bot-data/sheet-id.json fallback lives on disk and will be wiped on a
// BisectHosting restart, so if this variable is missing the bot will create a
// brand-new empty spreadsheet and lose all backed-up roles/verifications/groups.
if (!process.env.GOOGLE_SHEET_ID) {
  logger.warn(
    "GOOGLE_SHEET_ID is not set. On a filesystem wipe (e.g. BisectHosting restart) " +
    "access roles, verifications, and groups cannot be restored from Google Sheets. " +
    "Set GOOGLE_SHEET_ID to the spreadsheet ID in your host environment variables.",
  );
}

logger.info("Starting standalone Discord bot");

// Push any existing local stores to Google Sheets before the bot comes online.
// This ensures a backup exists even if no mutating commands run before the next
// host restart. Each call is a no-op when the corresponding local file is absent
// (i.e. we just restored from Sheets, or the store has never been written).
// allSettled so a Sheets outage doesn't prevent the bot from starting.
const backupResults = await Promise.allSettled([
  syncAccessToSheetsIfExists(),
  syncVerificationsToSheetsIfExists(),
  syncGroupsToSheetsIfExists(),
]);

for (const [i, result] of backupResults.entries()) {
  const name = ["access roles", "verifications", "groups"][i];
  if (result.status === "rejected") {
    logger.warn({ err: result.reason }, `Startup Sheets backup failed for ${name}`);
  } else {
    logger.info(`Startup Sheets backup completed for ${name}`);
  }
}

startBot().catch((err) => {
  logger.error({ err }, "Bot failed to start");
  process.exit(1);
});
