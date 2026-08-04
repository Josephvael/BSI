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

// ─── Seized item catalogue ────────────────────────────────────────────────────
// Grouped visually with emoji prefixes since Discord select menus have no
// native category support. Max 25 options per menu.
const SEIZED_OPTIONS = [
  // ── Firearms ──────────────────────────────────────────────────────────────
  { label: "🔫  Illegal Firearm(s)",       value: "firearm",      description: "Firearms — Illegal firearm(s)" },
  { label: "🔫  Unregistered Firearm(s)",  value: "unreg_gun",    description: "Firearms — Unregistered firearm(s)" },
  { label: "🔫  Ammunition",               value: "ammo",         description: "Firearms — Ammunition / rounds" },
  { label: "🔫  High-Cap Magazine(s)",     value: "hicap_mag",    description: "Firearms — High-capacity magazine(s)" },
  { label: "🔫  Suppressor(s)",            value: "suppressor",   description: "Firearms — Suppressor(s) / silencer(s)" },
  // ── Narcotics ─────────────────────────────────────────────────────────────
  { label: "💊  Cocaine",                  value: "cocaine",      description: "Narcotics — Cocaine" },
  { label: "💊  Methamphetamine",          value: "meth",         description: "Narcotics — Methamphetamine" },
  { label: "💊  Heroin",                   value: "heroin",       description: "Narcotics — Heroin" },
  { label: "💊  Fentanyl",                 value: "fentanyl",     description: "Narcotics — Fentanyl" },
  { label: "💊  Marijuana",                value: "marijuana",    description: "Narcotics — Marijuana" },
  { label: "💊  MDMA / Ecstasy",           value: "mdma",         description: "Narcotics — MDMA / Ecstasy" },
  { label: "💊  Unprescribed Rx Drugs",    value: "rx_drugs",     description: "Narcotics — Unprescribed prescription drugs" },
  // ── Paraphernalia ─────────────────────────────────────────────────────────
  { label: "⚗️  Drug Paraphernalia",       value: "paraphernalia",description: "Paraphernalia — General drug paraphernalia" },
  { label: "⚗️  Scale(s)",                 value: "scales",       description: "Paraphernalia — Scales / measuring tools" },
  { label: "⚗️  Packaging Materials",      value: "packaging",    description: "Paraphernalia — Bags, wraps, packaging" },
  { label: "⚗️  Pipe(s) / Smoking Device", value: "pipe",         description: "Paraphernalia — Pipe(s) or smoking device(s)" },
  // ── Other ─────────────────────────────────────────────────────────────────
  { label: "📦  Cash / Currency",          value: "cash",         description: "Other — Cash or currency" },
  { label: "📦  Stolen Property",          value: "stolen",       description: "Other — Stolen property" },
  { label: "📦  Other",                    value: "other",        description: "Other — Other seized item(s)" },
  // ── None ──────────────────────────────────────────────────────────────────
  { label: "✅  None / N/A",               value: "none",         description: "Nothing was seized" },
] as const;

type SeizedValue = (typeof SEIZED_OPTIONS)[number]["value"];

function getSeizedLabel(value: string): string {
  // Strip the emoji prefix (everything up to and including the two spaces)
  const raw = SEIZED_OPTIONS.find((o) => o.value === value)?.label ?? value;
  return raw.replace(/^.+?\s{2}/, "").trim();
}

// ─── Command definition ───────────────────────────────────────────────────────

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

// ─── Step 1: Seized select menu ───────────────────────────────────────────────

/** Shared between /filing and the panel button. */
export async function showSeizedSelectMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(FILING_SEIZED_SELECT_ID)
    .setPlaceholder("Select seized item(s)…")
    .setMinValues(1)
    .setMaxValues(3) // max 3 keeps us within Discord's 5-field modal limit
    .addOptions(SEIZED_OPTIONS);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content:
      "**Step 1 of 2** — Select what was seized *(choose up to 3 items, or None)*:",
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Step 2: Build & show the modal ──────────────────────────────────────────

/** Called when the user makes their selection(s). */
export async function handleSeizedSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const values = interaction.values as SeizedValue[];

  // If "none" is among the selections (or is the only one) treat as no seizure
  const isNone = values.includes("none");
  const items = isNone ? [] : values;

  // Encode selected items into the customId so the modal handler knows them
  // Format: "filing_modal:<item1>,<item2>,..."  or  "filing_modal:none"
  const customId = `filing_modal:${items.length ? items.join(",") : "none"}`;

  await interaction.showModal(buildFilingModal(customId, items));
}

/** Builds the 2–5 field filing modal. */
export function buildFilingModal(
  customId: string,
  seizedItems: string[],
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("File a Record");

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

  // One amount field per selected item (max 3 → total max 5 fields)
  for (const item of seizedItems) {
    const label = getSeizedLabel(item);
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`seized_${item}`)
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

// ─── Modal submit ─────────────────────────────────────────────────────────────

export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // customId: "filing_modal:<item1>,<item2>" or "filing_modal:none"
  const rawItems = interaction.customId.split(":")[1] ?? "none";
  const seizedItems = rawItems === "none" ? [] : rawItems.split(",");

  const username = interaction.fields.getTextInputValue("username");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");

  // Build seized summary: "2x Illegal Firearm(s), 1x Cocaine"
  const seizedParts: string[] = [];
  for (const item of seizedItems) {
    const amount = interaction.fields.getTextInputValue(`seized_${item}`);
    const label = getSeizedLabel(item);
    seizedParts.push(`${amount}x ${label}`);
  }
  const seized = seizedParts.join(", ");

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
