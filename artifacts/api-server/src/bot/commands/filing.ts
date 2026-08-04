import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { appendFiling } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const FILING_SEIZED_SELECT_ID = "filing_seized_select";

// The selectable seized item options
const SEIZED_OPTIONS = [
  { label: "None / N/A",            value: "none",          description: "Nothing was seized" },
  { label: "Illegal Firearm(s)",    value: "firearm",       description: "Illegal firearms" },
  { label: "Narcotics",             value: "narcotics",     description: "Illegal narcotics" },
  { label: "Drug Paraphernalia",    value: "paraphernalia", description: "Drug paraphernalia" },
  { label: "Ammunition",            value: "ammunition",    description: "Ammunition" },
  { label: "Other",                 value: "other",         description: "Other seized items" },
] as const;

type SeizedValue = (typeof SEIZED_OPTIONS)[number]["value"];

function getSeizedLabel(value: string): string {
  return SEIZED_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

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
  await showSeizedSelectMenu(interaction);
}

/** Shared: sends the ephemeral seized-item select menu. */
export async function showSeizedSelectMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(FILING_SEIZED_SELECT_ID)
    .setPlaceholder("Select seized item…")
    .addOptions(SEIZED_OPTIONS);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: "**Step 1 of 2** — What was seized?",
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Called when the user picks an item from the select menu. */
export async function handleSeizedSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const value = interaction.values[0] as SeizedValue;
  await interaction.showModal(buildFilingModal(value));
}

/** Builds the filing modal. Includes an "Amount" field unless "none" was chosen. */
export function buildFilingModal(seizedValue: SeizedValue | "none"): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`filing_modal:${seizedValue}`)
    .setTitle("File a Record");

  const rows: ActionRowBuilder<TextInputBuilder>[] = [
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
  ];

  if (seizedValue !== "none") {
    const label = getSeizedLabel(seizedValue);
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("seized_amount")
          .setLabel(`Amount of ${label}`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 2")
          .setRequired(true)
          .setMaxLength(50),
      ),
    );
  }

  modal.addComponents(...rows);
  return modal;
}

/** Called when the filing modal is submitted. */
export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // customId format: "filing_modal:<seizedValue>"
  const seizedValue = interaction.customId.split(":")[1] ?? "none";

  const username = interaction.fields.getTextInputValue("username");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");

  let seized = "";
  if (seizedValue !== "none") {
    const amount = interaction.fields.getTextInputValue("seized_amount");
    const label = getSeizedLabel(seizedValue);
    seized = `${amount}x ${label}`;
  }

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
