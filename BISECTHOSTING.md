# Deploying to BisectHosting

## Setup Steps

### 1. Create a BisectHosting Discord Bot Server
- Go to BisectHosting and create a new Discord Bot server
- Choose the Node.js runtime

### 2. Build the standalone bot bundle
Run this in the project:
```
pnpm --filter @workspace/api-server run build:standalone
```
This produces `artifacts/api-server/dist/bot-standalone.mjs` and the pino worker files.

### 3. Upload files to BisectHosting
Upload the entire `artifacts/api-server/dist/` folder via the BisectHosting file panel or SFTP.

### 4. Set environment variables in the BisectHosting panel
| Variable | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | Your bot token |
| `DISCORD_CLIENT_ID` | Your application ID |
| `DISCORD_GUILD_ID` | Your server ID |

> **Note on Google Sheets**: The bot uses the Replit Connectors proxy for Google Sheets auth.
> This proxy (`REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`) is only available when
> running on Replit. To use Google Sheets outside Replit, you would need to replace the connector
> in `src/bot/sheets.ts` with a direct Google Sheets API key (service account JSON).

### 5. Set the start command in BisectHosting
```
node dist/bot-standalone.mjs
```

### 6. Start the server
Start it in the BisectHosting panel. Watch the logs — on first start it will print the invite URL if the bot isn't in your server yet.

## Notes
- The bot stores data in `.bot-data/` — make sure this directory persists across restarts on BisectHosting
- `sheet-id.json` stores the Google Sheet ID
- `access.json` stores who has access to bot commands
- `verifications.json` stores Discord <-> Roblox links
