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
  .setDescription("File a new record");

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

  await interaction.showModal(buildFilingModal());
}

export function buildFilingModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("filing_modal")
    .setTitle("File a Record");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("username")
        .setLabel("Username")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. JohnDoe")
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("date_of_incident")
        .setLabel("Date of Incident")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 2024-01-15 or Jan 15, 2024")
        .setRequired(true)
        .setMaxLength(50),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("license_plate_vehicle")
        .setLabel("License Plate + Vehicle Type & Color")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. ABC-1234 | Blue Honda Civic")
        .setRequired(true)
        .setMaxLength(150),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("charges")
        .setLabel("Charges")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("List all charges, one per line")
        .setRequired(true)
        .setMaxLength(1000),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("seized")
        .setLabel("Seized (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Firearm, 2x bags narcotics")
        .setRequired(false)
        .setMaxLength(300),
    ),
  );

  return modal;
}

export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.fields.getTextInputValue("username");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");
  const licensePlateAndVehicle = interaction.fields.getTextInputValue("license_plate_vehicle");
  const charges = interaction.fields.getTextInputValue("charges");
  const seized = interaction.fields.getTextInputValue("seized") || "";

  try {
    await appendFiling({
      username,
      dateOfIncident,
      licensePlateAndVehicle,
      charges,
      seized,
      discordUserAndId: `${interaction.user.tag} | ${interaction.user.id}`,
      timestamp: new Date().toISOString(),
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Filing Submitted")
      .addFields(
        { name: "Username", value: username, inline: true },
        { name: "Date of Incident", value: dateOfIncident, inline: true },
        { name: "License Plate + Vehicle", value: licensePlateAndVehicle, inline: false },
        { name: "Charges", value: charges, inline: false },
        ...(seized ? [{ name: "Seized", value: seized, inline: false }] : []),
      )
      .setFooter({ text: `Filed by ${interaction.user.tag} (${interaction.user.id})` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to save filing");
    await interaction.editReply({
      content: "Something went wrong saving your filing. Please try again.",
    });
  }
}
