import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { appendFiling } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const filingCommand = new SlashCommandBuilder()
  .setName("filing")
  .setDescription("File a new record");

/** Opens the filing modal directly — no pre-steps. */
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

/** Shared between /filing and the panel button. */
export async function showFilingModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  await interaction.showModal(buildFilingModal());
}

export function buildFilingModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("filing_modal")
    .setTitle("File a Record")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("username")
          .setLabel("Offender's Username")
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
          .setCustomId("seized")
          .setLabel("Seized Items (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(
            "List each item and quantity, one per line:\n" +
            "2x Hawthorne M80\n" +
            "1x Bag of Nopyfruit\n" +
            "3x 9x19mm Bennetti Magazine",
          )
          .setRequired(false)
          .setMaxLength(1000),
      ),
    );
}

export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.fields.getTextInputValue("username");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");
  const seized = interaction.fields.getTextInputValue("seized").trim();

  try {
    await appendFiling({
      username,
      dateOfIncident,
      seized,
      discordUserAndId: `${interaction.user.tag} | ${interaction.user.id}`,
      timestamp: new Date().toISOString(),
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Filing Submitted")
      .addFields(
        { name: "Offender's Username", value: username, inline: true },
        { name: "Date of Incident", value: dateOfIncident, inline: true },
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
