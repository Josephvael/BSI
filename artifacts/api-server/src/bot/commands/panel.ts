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
} from "discord.js";
import { getAllowedRoles, checkAccess } from "../access";
import { buildFilingModal } from "./filing";

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
  const allowed = await getAllowedRoles();
  if (!checkAccess(interaction, allowed)) {
    await interaction.reply({
      content: "You do not have access to submit a filing.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildFilingModal());
}
