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
import { appendFiling } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const filingCommand = new SlashCommandBuilder()
  .setName("filing")
  .setDescription("File a new record — enter Username, License Plate, Date, Officer, and Notes");

export async function handleFilingCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const allowed = await getAllowedRoles();
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

  const dateInput = new TextInputBuilder()
    .setCustomId("date_of_incident")
    .setLabel("Date of Incident")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 2024-01-15 or Jan 15, 2024")
    .setRequired(true)
    .setMaxLength(50);

  const officerInput = new TextInputBuilder()
    .setCustomId("peace_officer")
    .setLabel("Name of Peace Officer")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. Officer Smith")
    .setRequired(true)
    .setMaxLength(100);

  const notesInput = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes & Evidence (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Any additional notes or evidence links")
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(licensePlateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(officerInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput),
  );

  await interaction.showModal(modal);
}

export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.fields.getTextInputValue("username");
  const licensePlate = interaction.fields.getTextInputValue("license_plate");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");
  const peaceOfficer = interaction.fields.getTextInputValue("peace_officer");
  const notes = interaction.fields.getTextInputValue("notes") || "";

  try {
    await appendFiling({
      timestamp: new Date().toISOString(),
      discordUser: interaction.user.tag,
      username,
      licensePlate,
      dateOfIncident,
      peaceOfficer,
      notes,
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Filing Submitted")
      .addFields(
        { name: "Username", value: username, inline: true },
        { name: "License Plate", value: licensePlate, inline: true },
        { name: "Date of Incident", value: dateOfIncident, inline: true },
        { name: "Peace Officer", value: peaceOfficer, inline: true },
        ...(notes ? [{ name: "Notes & Evidence", value: notes, inline: false }] : []),
      )
      .setFooter({ text: `Filed by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to save filing");
    await interaction.editReply({
      content: "Something went wrong saving your filing. Please try again.",
    });
  }
}
