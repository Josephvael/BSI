import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ChatInputCommandInteraction,
  ButtonInteraction,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getAllowedUsers, checkAccess } from "../access";

export const PANEL_BUTTON_ID = "panel_file_report";

export const panelCommand = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Post the DSI Filing Center panel in this channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function handlePanelCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5dade2)
    .setTitle("Clark County's DSI Filing Center")
    .setDescription(
      "Use the button below to submit a report of an arrest relating to:\n\n" +
      "• Illegal Firearms\n" +
      "• Illegal Firearm Distribution\n" +
      "• Illegal Possession of Narcotics\n" +
      "• Possession of drug paraphernalia\n\n" +
      "Please note, that additional information that relates to the arrest is required (Additional Charges, etc).",
    )
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId(PANEL_BUTTON_ID)
    .setLabel("File a Report")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Panel posted!" });
  await interaction.channel!.send({ embeds: [embed], components: [row] });
}

export async function handlePanelButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const allowed = await getAllowedUsers();
  if (!checkAccess(interaction, allowed)) {
    await interaction.reply({
      content: "You do not have access to submit a filing.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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
        .setCustomId("license_plate")
        .setLabel("License Plate")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. ABC-1234")
        .setRequired(true)
        .setMaxLength(20),
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
        .setCustomId("peace_officer")
        .setLabel("Name of Peace Officer")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Officer Smith")
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Notes & Evidence (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Any additional notes or evidence links")
        .setRequired(false)
        .setMaxLength(1000),
    ),
  );

  await interaction.showModal(modal);
}
