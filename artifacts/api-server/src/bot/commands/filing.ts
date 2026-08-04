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

// ─── Interaction ID constants ──────────────────────────────────────────────────
export const FILING_CAT_SELECT_ID = "filing_cat_select";
export const FILING_ITEM_SELECT_PREFIX = "filing_item_select";

// ─── Item catalogue ────────────────────────────────────────────────────────────
// Discord select menus hold max 25 options, so WEAPONS (39) and AMMUNITION (29)
// are split across two pages each.

interface Category {
  label: string;   // shown in category picker
  prefix: string;  // short code used to encode values: "<prefix>_<index>"
  items: string[]; // display labels
}

const CATEGORIES: Record<string, Category> = {
  weapons_1: {
    label: "Weapons (1 / 2)",
    prefix: "w1",
    items: [
      "Albert & Heinrich SM9", "Albert & Heinrich LM2", "Albert & Heinrich HR4",
      "Afanasev Pistolet 1951", "Bennetti 15", "Bennetti 17", "Cobray MP18",
      "Delino R20", "Delino R20P", "Delino R21", "Delino R21A", "Delino R21B",
      "Delino R21M", "Delino XM21", "Delino XR21", "Delino Defender",
      "Delino Special", "Fedotovo Karabin 1949", "Hawthorne 500", "Hawthorne 800",
    ],
  },
  weapons_2: {
    label: "Weapons (2 / 2)",
    prefix: "w2",
    items: [
      "Hawthorne M80", "Hawthorne M80A1", "Hawthorne M80A2", "Hawthorne M80T",
      "Kilikov 54U", "Kilikov M62", "Krovin M9871", "Krovin Strelok 1981",
      "Krovin Vintovka 1891", "Kilikov Machinu 1962", "Kilikov Pulemyot 1971",
      "Kovrovsky Avtomat 1941", "Klimosvk Drobovik S23K", "Millsburg 780A1",
      "Mustang M45", "Pietro 92P", "Protec DC9", "R84 Anti-Tank Launcher",
      "Xion XI26",
    ],
  },
  ammo_1: {
    label: "Ammunition (1 / 2)",
    prefix: "a1",
    items: [
      "5.45x39mm Kilkov Magazine", "5.45x39mm Kilikov Extended",
      "30rd 5.56x45mm STANORD", "20rd 5.56x45mm STANORD",
      "5.56 Box Magazine", "5.56 Box Magazine (Tracer)",
      "9x19mm Bennetti Magazine", "9x19mm Straight Magazine",
      "9x19mm Curved Magazine", "9x19mm 33rd Magazine", "9x18mm Afanasev",
      ".40 Automatic Pierto", ".45 Automatic Delino Magazine",
      ".45 Mitch & Kosi Magazine", "7.62x25mm Tula Kovrovksy",
      "7.62x25mm 71rd Drum", "7.62x39mm Klikov Drum", "7.62x39mm Klikov",
      "7.62x39mm Klikov Extended", "7.62x39 Clip",
    ],
  },
  ammo_2: {
    label: "Ammunition (2 / 2)",
    prefix: "a2",
    items: [
      "7.62x51mm Albert & Heinrich", "7.62x54mmR Krovin", "7.62x54mm Rimmed",
      "23x75mm Rimmed", "10rd .308 Frankford Hawthorne", "5rd .308 Frankford",
      ".44 Delino", "12 Gauge", "Taser Cartridge",
    ],
  },
  kits: {
    label: "Weapon Kits",
    prefix: "k",
    items: [
      "Assault Rifle Kit", "Assault Carbine Kit", "Battle Rifle Kit",
      "Carbine Kit", "Light Machine Gun Kit", "Machine Pistol Kit",
      "Pistol Kit", "Revolver Kit", "Rifle Kit", "Shotgun Kit",
      "Sniper Rifle Kit", "Submachine Gun Kit",
    ],
  },
  stolen: {
    label: "Stolen Goods",
    prefix: "s",
    items: [
      "Bag of Dirty Money", "Folder of Military Intelligence",
      "Military Encryption Card",
    ],
  },
  narcotics: {
    label: "Narcotics",
    prefix: "n",
    items: [
      "Bag of Nopyfruit", "Barrel of Nopyfruit Concentrate", "Bag of Gushie",
      "Barrel of Solution", "Box of Plastic Bags", "Jarniwus", "Jarniwus Seeds",
    ],
  },
  cargo: {
    label: "Illicit Cargo",
    prefix: "c",
    items: [
      "Crate of Illegal Firearm Parts", "Crate of Illegal Ammunition",
      "Coin-o-Matic Business Conveyer",
    ],
  },
  devices: {
    label: "Destructive Devices",
    prefix: "d",
    items: [
      "Barrel of Thermite", "Detonator", "Encrypted Phone",
      "Jerrybomb", "Molotov", "Tear Gas",
    ],
  },
  misc: {
    label: "Misc. Items",
    prefix: "m",
    items: [
      "Cones", "Handcuffs", "Highland NR28",
      "Lockpicks", "Spike Strips", "The Underground' Business Card",
    ],
  },
};

// Build flat lookup: encoded value (e.g. "w1_3") → display label
const ITEM_LABEL: Record<string, string> = {};
for (const cat of Object.values(CATEGORIES)) {
  cat.items.forEach((item, idx) => {
    ITEM_LABEL[`${cat.prefix}_${idx}`] = item;
  });
}

function getItemLabel(code: string): string {
  return ITEM_LABEL[code] ?? code;
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
  await showCategorySelectMenu(interaction);
}

// ─── Step 1: Category picker ──────────────────────────────────────────────────

/** Shared between /filing and the panel button. */
export async function showCategorySelectMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const options = [
    ...Object.entries(CATEGORIES).map(([key, cat]) => ({
      label: cat.label,
      value: key,
    })),
    { label: "None / N/A", value: "none" },
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId(FILING_CAT_SELECT_ID)
    .setPlaceholder("Select a seized item category…")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: "**Step 1 of 3** — Choose a seized item category *(or None)*:",
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Called when the user picks a category. */
export async function handleCatSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const categoryKey = interaction.values[0];

  // "None" selected — skip to modal immediately with no seized items
  if (categoryKey === "none") {
    await interaction.showModal(buildFilingModal("filing_modal:none", []));
    return;
  }

  const cat = CATEGORIES[categoryKey];
  if (!cat) {
    await interaction.update({ content: "Unknown category. Please try again.", components: [] });
    return;
  }

  const itemOptions = cat.items.map((item, idx) => ({
    label: item,
    value: `${cat.prefix}_${idx}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${FILING_ITEM_SELECT_PREFIX}:${categoryKey}`)
    .setPlaceholder(`Select item(s) from ${cat.label}…`)
    .setMinValues(1)
    .setMaxValues(Math.min(3, itemOptions.length))
    .addOptions(itemOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.update({
    content: `**Step 2 of 3** — Select up to **3** items from ${cat.label}:`,
    components: [row],
  });
}

// ─── Step 2: Item picker ──────────────────────────────────────────────────────

/** Called when the user selects specific items from a category. */
export async function handleItemSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const itemCodes = interaction.values; // e.g. ["w1_0", "w1_5"]
  const customId = `filing_modal:${itemCodes.join(",")}`;
  await interaction.showModal(buildFilingModal(customId, itemCodes));
}

// ─── Step 3: Modal ────────────────────────────────────────────────────────────

/** Builds the filing modal — 2 fixed fields + one amount field per seized item (max 3). */
export function buildFilingModal(customId: string, itemCodes: string[]): ModalBuilder {
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

  // One amount field per seized item (max 3 → total 5 fields)
  for (const code of itemCodes.slice(0, 3)) {
    const label = getItemLabel(code);
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`amt_${code}`)
          .setLabel(`Amount — ${label}`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 2")
          .setRequired(true)
          .setMaxLength(20),
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

  // customId: "filing_modal:<code1>,<code2>" or "filing_modal:none"
  const rawCodes = interaction.customId.split(":")[1] ?? "none";
  const itemCodes = rawCodes === "none" ? [] : rawCodes.split(",");

  const username = interaction.fields.getTextInputValue("username");
  const dateOfIncident = interaction.fields.getTextInputValue("date_of_incident");

  // Build seized string: "2x Hawthorne M80, 1x Jarniwus"
  const seizedParts: string[] = [];
  for (const code of itemCodes) {
    const amount = interaction.fields.getTextInputValue(`amt_${code}`);
    const label = getItemLabel(code);
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
