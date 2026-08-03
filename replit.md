# Discord Filing Bot

A Discord bot with `/filing` and `/statistics` slash commands that log records to Google Sheets.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: discord.js v14
- Sheets: Replit Google Sheets connector (`@replit/connectors-sdk`)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/bot/index.ts` — bot startup, command registration, interaction routing
- `artifacts/api-server/src/bot/commands/filing.ts` — `/filing` slash command + modal handler
- `artifacts/api-server/src/bot/commands/statistics.ts` — `/statistics` slash command
- `artifacts/api-server/src/bot/sheets.ts` — Google Sheets read/write helpers
- `.bot-data/sheet-id.json` — auto-created; stores the Google Sheet ID after first run

## Bot Setup (one-time)

1. Invite the bot to your Discord server using the invite URL printed in the server logs on startup.
2. Once added, restart the API Server workflow — it will auto-register the slash commands.
3. The Google Sheet is auto-created on the first `/filing` submission. The sheet URL is printed in logs.

## Bot Commands

| Command | Description |
|---|---|
| `/filing` | Opens a modal — fill in Username, License Plate, Profession. Saves to Google Sheet. |
| `/statistics` | Shows total filings, top professions, and the 5 most recent records. Links to the sheet. |

## Google Sheet

- Auto-created on first filing with a header row: Timestamp, Discord User, Username, License Plate, Profession
- Sheet URL is printed in server logs after creation
- Re-uses the same sheet across restarts (ID stored in `.bot-data/sheet-id.json`)

## Required Secrets

- `DISCORD_BOT_TOKEN` — bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` — application ID
- `DISCORD_GUILD_ID` — target server ID
- Google Sheets: connected via Replit OAuth integration (no manual key needed)

## User preferences

_Populate as you build._

## Gotchas

- The bot must be **invited to the server** before slash commands can be registered. The invite URL is logged at startup.
- After inviting the bot, **restart the API Server workflow** once — commands register automatically on reconnect.
- `.bot-data/sheet-id.json` is created on first filing. Delete it to force a new spreadsheet to be created.
