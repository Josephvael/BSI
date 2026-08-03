import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { appendFiling, getSheetUrl } from "../sheets";
import { getAllowedUsers, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const filingCommand = new SlashCommandBuilder()
  .setName("filing")
  .setDescription("File a new record — enter Username, License Plate, and Possession");

export async function handleFilingCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const allowed = await getAllowedUsers();
  if (!checkAccess(interaction, allowed)) {
    await interaction.reply({
      content: "You do not have access to this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId("filing_modal")
    .setTitle("File a Record");

  const usernameInput = new TextInputBuilder()
    .setCustomId("username")
    .setLabel("Username")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. JohnDoe")
    .setRequired(true)
    .setMaxLength(100);

  const licensePlateInput = new TextInputBuilder()
    .setCustomId("license_plate")
    .setLabel("License Plate")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. ABC-1234")
    .setRequired(true)
    .setMaxLength(20);

  const possessionInput = new TextInputBuilder()
    .setCustomId("profession")
    .setLabel("Possession")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. Vehicle, Weapon, Item")
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(licensePlateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(possessionInput),
  );

  await interaction.showModal(modal);
}

export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.fields.getTextInputValue("username");
  const licensePlate = interaction.fields.getTextInputValue("license_plate");
  const possession = interaction.fields.getTextInputValue("profession");

  try {
    await appendFiling({
      timestamp: new Date().toISOString(),
      discordUser: interaction.user.tag,
      username,
      licensePlate,
      profession: possession,
    });

    const sheetUrl = await getSheetUrl();

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Filing Submitted")
      .addFields(
        { name: "Username", value: username, inline: true },
        { name: "License Plate", value: licensePlate, inline: true },
        { name: "Possession", value: possession, inline: true },
      )
      .setFooter({ text: `Filed by ${interaction.user.tag} | View spreadsheet: ${sheetUrl}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to save filing");
    await interaction.editReply({
      content: "Something went wrong saving your filing. Please try again.",
    });
  }
}
