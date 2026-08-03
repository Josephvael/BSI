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
 */

import { startBot } from "./bot/index";
import { logger } from "./lib/logger";

logger.info("Starting standalone Discord bot");

startBot().catch((err) => {
  logger.error({ err }, "Bot failed to start");
  process.exit(1);
});
