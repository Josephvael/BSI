import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { appendFiling, getSheetUrl } from "../sheets";
import { logger } from "../../lib/logger";

export const filingCommand = new SlashCommandBuilder()
  .setName("filing")
  .setDescription("File a new record — enter Username, License Plate, and Profession");

export async function handleFilingCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
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

  const professionInput = new TextInputBuilder()
    .setCustomId("profession")
    .setLabel("Possession")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. Vehicle, Weapon, Item")
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(licensePlateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(professionInput),
  );

  await interaction.showModal(modal);
}

export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const username = interaction.fields.getTextInputValue("username");
  const licensePlate = interaction.fields.getTextInputValue("license_plate");
  const profession = interaction.fields.getTextInputValue("profession");

  try {
    await appendFiling({
      timestamp: new Date().toISOString(),
      discordUser: interaction.user.tag,
      username,
      licensePlate,
      profession,
    });

    const sheetUrl = await getSheetUrl();

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Filing Submitted")
      .addFields(
        { name: "Username", value: username, inline: true },
        { name: "License Plate", value: licensePlate, inline: true },
        { name: "Possession", value: profession, inline: true },
      )
      .setFooter({ text: `Filed by ${interaction.user.tag} · View spreadsheet: ${sheetUrl}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to save filing");
    await interaction.editReply({
      content: "❌ Something went wrong saving your filing. Please try again.",
    });
  }
}
