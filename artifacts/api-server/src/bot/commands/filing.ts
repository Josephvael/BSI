import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
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

export const filingCommand = new SlashCommandBuilder()
  .setName("filing")
  .setDescription("File a new record");

// ─── Seized item catalogue ────────────────────────────────────────────────────

const CATEGORIES: Record<string, { label: string; items: string[] }> = {
  // Delino has 28 items — split into two groups to stay under Discord's 25-option limit
  delino_rifles: {
    label: "Delino — R-Series Rifles",
    items: [
      "Delino R20", "Upgraded Delino R20",
      "Delino R21", "Delino R21 'Canner'", "Upgrade Delino R21",
      "Delino R21M", "Upgraded Delino R21M",
      "Delino R21A", "Upgraded Delino R21A", "Imported Delino R21A",
      "Delino R21B", "Upgraded Delino R21B",
      "Delino XR21", "Upgraded Delino XR21",
      "Delino R20P", "Delino R21P",
      "Ceremonial Delino R-1",
    ],
  },
  delino_pistols: {
    label: "Delino — Pistols & Ammo",
    items: [
      "Delino P45", "Upgraded Delino P45",
      "Delino Defender", "Upgraded Delino Defender",
      "Delino Special", "Upgraded Delino Special",
      "Delino Police",
      "Mustang M45", "Mustang M45 Surplus",
      ".45 Automatic Delino Magazine", ".44 Delino",
    ],
  },
  hawthorn: {
    label: "Hawthorn Firearms",
    items: [
      "Hawthorn 500", "Upgraded Hawthorn 500",
      "Hawthorn 800", "Upgraded Hawthorn 800",
      "Hawthorn M80A1", "Upgraded Hawthorn M80A1",
      "Hawthorn M80A2", "Upgraded Hawthorn M80A2",
      "10rd .308 Frankford Hawthorne", "5rd .308 Frankford",
    ],
  },
  bennetti: {
    label: "Bennetti Firearms",
    items: [
      "Bennetti 15", "Upgraded Bennetti 15",
      "Bennetti 17", "Upgraded Bennetti 17",
      "Pietro 86P", "Upgraded Pietro 86P",
      "Pietro 92P", "Upgraded Pietro 92P",
      "Mich & Kosi 4605", "Upgraded Mich & Kosi 4605",
      "Neuhausen P9A", "Updated Neuhausen P9A",
      "Millsburg 780A1", "Upgraded Millsburg 780A1",
      "9x19mm Bennetti Magazine", "9x19mm Straight Magazine",
      "9x19mm Curved Magazine", "9x19mm 33rd Magazine",
      ".40 Automatic Pierto", ".45 Mitch & Kosi Magazine", "12 Gauge",
    ],
  },
  albert_etc: {
    label: "Albert, Protec & Cobray",
    items: [
      "Albert & Heinrich SM9", "Upgraded Albert & Heinrich SM9",
      "Albert & Heinrich LM2", "Albert & Heinrich HR4",
      "7.62x51mm Albert & Heinrich",
      "Protec DC9",
      "Cobray MP18", "Upgraded Cobray MP18",
    ],
  },
  kilikov: {
    label: "Kilikov",
    items: [
      "Imported Kilikov 54U", "Kilikov 54U", "Upgraded Kilikov 54U",
      "Kilikov Machinu 1962", "Upgraded Kilikov Machinu 1962",
      "Kilikov Pulemyot 1971", "Upgraded Kilikov Pulemyot 1971",
      "5.45x39mm Kilikov Magazine", "5.45x39mm Kilikov Extended",
      "7.62x39mm Kilikov", "7.62x39mm Kilikov Extended", "7.62x39mm Kilikov Drum",
    ],
  },
  other_russian: {
    label: "Other Russian Firearms & Ammo",
    items: [
      "Krovin Vintovka 1891", "Upgraded Krovin Vintovka 1891",
      "Krovin Strelok 1891", "Upgraded Krovin Strelok 1891",
      "Fedotovo Karabin 1949", "Upgraded Fedotovo Karabin 1949",
      "Klimovsk Drobovik Spetsialniy 23K", "Afanasev Pistolet 1951",
      "Kovrovsky Avtomat 1941",
      "30rd 5.56x45mm STANORD", "20rd 5.56x45mm STANORD",
      "5.56 Box Magazine", "5.56 Box Magazine (Tracer)",
      "9x18mm Afanasev", "7.62x25mm Tula Kovrovksy", "7.62x25mm 71rd Drum",
      "7.62x39 Clip",
      "7.62x54mmR Krovin", "7.62x54mm Rimmed", "23x75mm Rimmed",
    ],
  },
  weapon_kits: {
    label: "Weapon Kits",
    items: [
      "Assault Rifle Kit", "Assault Carbine Kit", "Battle Rifle Kit",
      "Carbine Kit", "Light Machine Gun Kit", "Machine Pistol Kit",
      "Pistol Kit", "Revolver Kit", "Rifle Kit",
      "Shotgun Kit", "Sniper Rifle Kit", "Submachine Gun Kit",
    ],
  },
  stolen_illicit: {
    label: "Stolen Goods & Illicit Cargo",
    items: [
      "Bag of Dirty Money", "Folder of Military Intelligence", "Military Encryption Card",
      "Crate of Illegal Firearm Parts", "Crate of Illegal Ammunition",
      "Coin-o-Matic Business Conveyer",
    ],
  },
  narcotics: {
    label: "Narcotics",
    items: [
      "Bag of Nopyfruit", "Barrel of Nopyfruit Concentrate",
      "Bag of Gushie", "Barrel of Solution", "Box of Plastic Bags",
      "Jarniwus", "Jarniwus Seeds",
    ],
  },
  destructive: {
    label: "Destructive Devices",
    items: [
      "Barrel of Thermite", "Detonator", "Encrypted Phone",
      "Jerrybomb", "Molotov", "Tear Gas",
    ],
  },
  misc: {
    label: "Misc",
    items: [
      "Xion TI26", "Highland NR28",
      "Cones", "Handcuffs", "Lockpicks", "Spike Strips",
      "Taser Cartridge", "The Underground Business Card",
    ],
  },
};

// ─── CustomId constants ───────────────────────────────────────────────────────

export const FILING_CAT_SELECT_ID = "filing_cat_select";
export const FILING_ITEM_SELECT_PREFIX = "filing_item_select";
export const FILING_QTY_MODAL_ID = "filing_qty_modal";
export const FILING_ADD_MORE_BUTTON_ID = "filing_add_more";
export const FILING_CONTINUE_BUTTON_ID = "filing_continue";

// ─── Per-user session state ───────────────────────────────────────────────────

interface FilingState {
  /** Items confirmed with quantities so far this session. */
  accumulated: { name: string; qty: number }[];
  /** Items just selected from a category, awaiting quantity input. */
  draft: string[];
}

const pendingState = new Map<string, FilingState>();

// ─── UI builders ─────────────────────────────────────────────────────────────

function buildCategoryRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(FILING_CAT_SELECT_ID)
      .setPlaceholder("Select a seized item category…")
      .addOptions([
        ...Object.entries(CATEGORIES).map(([key, cat]) => ({
          label: cat.label,
          value: key,
        })),
        { label: "None / No Seizure", value: "none" },
      ]),
  );
}

function buildQtyModal(items: string[]): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(FILING_QTY_MODAL_ID)
    .setTitle("Enter quantities");

  // Discord modal limit: 5 components
  const capped = items.slice(0, 5);
  for (let i = 0; i < capped.length; i++) {
    const label = capped[i].length > 45 ? capped[i].slice(0, 42) + "…" : capped[i];
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`qty_${i}`)
          .setLabel(label)
          .setStyle(TextInputStyle.Short)
          .setValue("1")
          .setMinLength(1)
          .setMaxLength(3)
          .setPlaceholder("1–99")
          .setRequired(true),
      ),
    );
  }
  return modal;
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
    );
}

function buildSummaryComponents(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(FILING_ADD_MORE_BUTTON_ID)
      .setLabel("← Add more items")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FILING_CONTINUE_BUTTON_ID)
      .setLabel("Continue to filing →")
      .setStyle(ButtonStyle.Primary),
  );
}

function formatAccumulated(items: { name: string; qty: number }[]): string {
  return items.map((i) => `• ${i.qty}× ${i.name}`).join("\n");
}

// ─── Interaction handlers ─────────────────────────────────────────────────────

export async function showCategorySelectMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  // Fresh session — clear any leftover state for this user
  pendingState.set(interaction.user.id, { accumulated: [], draft: [] });

  await interaction.reply({
    content: "**Select a category of seized items** (pick None if nothing was seized):",
    components: [buildCategoryRow()],
    flags: MessageFlags.Ephemeral,
  });
}

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
  await showCategorySelectMenu(interaction);
}

/** Category picker — routes to item select or straight to modal for "none". */
export async function handleCatSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const catKey = interaction.values[0];

  if (catKey === "none") {
    const state = pendingState.get(interaction.user.id) ?? { accumulated: [], draft: [] };
    pendingState.set(interaction.user.id, { ...state, draft: [] });
    await interaction.showModal(buildFilingModal());
    return;
  }

  const cat = CATEGORIES[catKey];
  if (!cat) {
    await interaction.update({ content: "Unknown category — please try again.", components: [] });
    return;
  }

  const options = cat.items.map((item, idx) => ({
    label: item.length > 100 ? item.slice(0, 97) + "…" : item,
    value: String(idx),
  }));

  const state = pendingState.get(interaction.user.id);
  const accLine =
    state && state.accumulated.length > 0
      ? `\n\n**Already added:** ${state.accumulated.map((i) => `${i.qty}× ${i.name}`).join(", ")}`
      : "";

  await interaction.update({
    content: `**${cat.label}** — select items (up to 5):${accLine}`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${FILING_ITEM_SELECT_PREFIX}:${catKey}`)
          .setPlaceholder("Pick items (hold Ctrl/Cmd to select multiple)")
          .setMinValues(1)
          .setMaxValues(Math.min(options.length, 5))
          .addOptions(options),
      ),
    ],
  });
}

/** Item picker — stores draft and opens the quantity modal. */
export async function handleItemSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const catKey = interaction.customId.slice(FILING_ITEM_SELECT_PREFIX.length + 1);
  const cat = CATEGORIES[catKey];
  const draft = interaction.values.map((val) => cat?.items[parseInt(val, 10)] ?? val);

  const state = pendingState.get(interaction.user.id) ?? { accumulated: [], draft: [] };
  pendingState.set(interaction.user.id, { ...state, draft });

  await interaction.showModal(buildQtyModal(draft));
}

/** Quantity modal — merges draft + quantities into accumulated, shows summary. */
export async function handleQtyModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const state = pendingState.get(interaction.user.id) ?? { accumulated: [], draft: [] };
  const { draft } = state;

  const newItems = draft.slice(0, 5).map((name, i) => {
    const raw = interaction.fields.getTextInputValue(`qty_${i}`);
    const qty = Math.min(99, Math.max(1, parseInt(raw, 10) || 1));
    return { name, qty };
  });

  const accumulated = [...state.accumulated, ...newItems];
  pendingState.set(interaction.user.id, { accumulated, draft: [] });

  await interaction.reply({
    content:
      `**Seized items (${accumulated.length} item${accumulated.length !== 1 ? "s" : ""}):**\n` +
      formatAccumulated(accumulated) +
      "\n\nAdd items from another category, or continue to the filing form.",
    components: [buildSummaryComponents()],
    flags: MessageFlags.Ephemeral,
  });
}

/** "Add more items" button — returns to category picker while keeping accumulated items. */
export async function handleAddMoreButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const state = pendingState.get(interaction.user.id);
  const accLine =
    state && state.accumulated.length > 0
      ? `**Already added:**\n${formatAccumulated(state.accumulated)}\n\n`
      : "";

  await interaction.update({
    content: `${accLine}**Select another category to add more items:**`,
    components: [buildCategoryRow()],
  });
}

/** "Continue to filing" button — opens the username/date modal. */
export async function handleContinueButton(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.showModal(buildFilingModal());
}

/** Filing modal — assembles the full record and saves it to the sheet. */
export async function handleFilingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.fields.getTextInputValue("username");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");

  const state = pendingState.get(interaction.user.id) ?? { accumulated: [], draft: [] };
  pendingState.delete(interaction.user.id);

  const seized = state.accumulated.map((i) => `${i.qty}x ${i.name}`).join(", ");

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
        ...(state.accumulated.length > 0
          ? [{ name: "Seized", value: formatAccumulated(state.accumulated), inline: false }]
          : []),
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
