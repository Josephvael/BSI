import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  OAuth2Scopes,
  PermissionFlagsBits,
} from "discord.js";
import { logger } from "../lib/logger";
import { setDiscordClient } from "./discord-client";
import {
  filingCommand, handleFilingCommand, handleFilingModal,
  handleCatSelect, handleItemSelect, handleQtyModal,
  handleAddMoreButton, handleContinueButton, handleBackButton,
  FILING_CAT_SELECT_ID, FILING_ITEM_SELECT_PREFIX,
  FILING_QTY_MODAL_ID, FILING_ADD_MORE_BUTTON_ID, FILING_CONTINUE_BUTTON_ID, FILING_BACK_BUTTON_ID,
} from "./commands/filing";
import { statisticsCommand, handleStatisticsCommand } from "./commands/statistics";
import { accessCommand, handleAccessCommand } from "./commands/access";
import { robloxCommand, handleRobloxCommand } from "./commands/roblox";
import { groupsCommand, handleGroupsCommand } from "./commands/groups";
import { searchCommand, handleSearchCommand } from "./commands/search";
import { panelCommand, handlePanelCommand, handlePanelButton, PANEL_BUTTON_ID } from "./commands/panel";

const commands = [
  filingCommand.toJSON(),
  statisticsCommand.toJSON(),
  accessCommand.toJSON(),
  robloxCommand.toJSON(),
  groupsCommand.toJSON(),
  searchCommand.toJSON(),
  panelCommand.toJSON(),
];

function buildInviteUrl(clientId: string): string {
  const scopes = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join("%20");
  const perms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=${scopes}`;
}

async function registerCommands(
  token: string,
  clientId: string,
  guildId: string,
): Promise<boolean> {
  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info({ commandCount: commands.length }, "Slash commands registered with Discord");
    return true;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 50001) {
      logger.warn(
        { inviteUrl: buildInviteUrl(clientId) },
        "Bot is not in the guild yet. Add it via the invite URL above, then restart the server.",
      );
    } else {
      logger.error({ err }, "Failed to register slash commands");
    }
    return false;
  }
}

export async function startBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];
  const guildId = process.env["DISCORD_GUILD_ID"];

  if (!token || !clientId || !guildId) {
    logger.warn(
      "DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID not set — bot will not start",
    );
    return;
  }

  logger.info({ inviteUrl: buildInviteUrl(clientId) }, "Discord bot invite URL");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot is online");
    setDiscordClient(client);
    await registerCommands(token, clientId, guildId);
  });

  client.on(Events.GuildCreate, async (guild) => {
    if (guild.id === guildId) {
      logger.info({ guildName: guild.name }, "Bot joined the target guild — registering commands");
      await registerCommands(token, clientId, guildId);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "filing") {
          await handleFilingCommand(interaction);
        } else if (interaction.commandName === "statistics") {
          await handleStatisticsCommand(interaction);
        } else if (interaction.commandName === "access") {
          await handleAccessCommand(interaction);
        } else if (interaction.commandName === "roblox") {
          await handleRobloxCommand(interaction);
        } else if (interaction.commandName === "groups") {
          await handleGroupsCommand(interaction);
        } else if (interaction.commandName === "search") {
          await handleSearchCommand(interaction);
        } else if (interaction.commandName === "panel") {
          await handlePanelCommand(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === PANEL_BUTTON_ID) {
          await handlePanelButton(interaction);
        } else if (interaction.customId === FILING_ADD_MORE_BUTTON_ID) {
          await handleAddMoreButton(interaction);
        } else if (interaction.customId === FILING_CONTINUE_BUTTON_ID) {
          await handleContinueButton(interaction);
        } else if (interaction.customId === FILING_BACK_BUTTON_ID) {
          await handleBackButton(interaction);
        }
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === FILING_CAT_SELECT_ID) {
          await handleCatSelect(interaction);
        } else if (interaction.customId.startsWith(`${FILING_ITEM_SELECT_PREFIX}:`)) {
          await handleItemSelect(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === FILING_QTY_MODAL_ID) {
          await handleQtyModal(interaction);
        } else if (interaction.customId === "filing_modal") {
          await handleFilingModal(interaction);
        }
      }
    } catch (err) {
      logger.error({ err, interactionType: interaction.type }, "Error handling Discord interaction");
    }
  });

  await client.login(token);
}
