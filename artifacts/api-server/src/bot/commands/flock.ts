/**
 * /flock — Project FlockLLM
 *
 * Collects Roblox marketplace items (ID, name, link) via the public Catalog API
 * and delivers them as a JSONL file attachment.
 *
 * Access: restricted to the single Discord user defined in FLOCK_OWNER_USERNAME
 * (default: "lilbean1980s").  Optionally override via FLOCK_OWNER_USERNAME env var.
 *
 * Subcommands:
 *   /flock collect          — run collection with current saved settings
 *   /flock set [options]    — update per-category limits and sort order
 *   /flock settings         — display current settings without collecting
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { logger } from "../../lib/logger";

// ─── Access control ───────────────────────────────────────────────────────────

const FLOCK_OWNER_USERNAME = process.env.FLOCK_OWNER_USERNAME ?? "lilbean1980s";

function hasAccess(interaction: ChatInputCommandInteraction): boolean {
  return interaction.user.username === FLOCK_OWNER_USERNAME;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_FILE = "./.bot-data/flock-settings.json";

export interface FlockSettings {
  sort:        string; // "popular" | "bestselling" | "recent" | "new" | "relevant"
  all:         number; // items from the general "All" catalog (0 = skip)
  shirts:      number;
  pants:       number;
  tshirts:     number;
  accessories: number;
  bundles:     number;
  gear:        number;
}

const DEFAULT_SETTINGS: FlockSettings = {
  sort:        "popular",
  all:         0,
  shirts:      500,
  pants:       500,
  tshirts:     300,
  accessories: 1000,
  bundles:     200,
  gear:        200,
};

async function loadSettings(): Promise<FlockSettings> {
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<FlockSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(s: FlockSettings): Promise<void> {
  await mkdir("./.bot-data", { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// ─── Roblox Catalog API ───────────────────────────────────────────────────────

const SORT_TYPES: Record<string, string> = {
  relevant:    "0",
  popular:     "1", // most favorited
  bestselling: "2",
  recent:      "3", // recently updated
  new:         "4", // recently created
};

const CATEGORY_PARAMS: Record<keyof Omit<FlockSettings, "sort">, Record<string, string>> = {
  all:         { category: "All" },
  shirts:      { category: "Clothing", subcategory: "ClassicShirts" },
  pants:       { category: "Clothing", subcategory: "ClassicPants" },
  tshirts:     { category: "Clothing", subcategory: "ClassicTShirts" },
  accessories: { category: "Accessories" },
  bundles:     { category: "Bundles" },
  gear:        { category: "Gear" },
};

const VALID_PAGE_SIZES = [10, 28, 30, 60, 120];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchCatalogPage(
  params: Record<string, string>,
  sortType: string,
  cursor: string,
  limit: number,
): Promise<{ items: { id: number; name: string }[]; nextCursor: string }> {
  const ideal     = Math.min(limit, 120);
  const batchSize = VALID_PAGE_SIZES.find((s) => s >= ideal) ?? 120;

  const q = new URLSearchParams({
    limit: String(batchSize),
    sortType,
    ...params,
    ...(cursor ? { cursor } : {}),
  });

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://catalog.roblox.com/v1/search/items?${q}`, {
      headers: { "User-Agent": "FlockLLM/1.0 (educational data collection)" },
    });

    if (res.status === 429) {
      const wait = Math.min(2000 * 2 ** attempt, 30000);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Roblox API ${res.status} ${res.statusText}`);

    const data = (await res.json()) as {
      data?: { id: number; name?: string }[];
      nextPageCursor?: string;
    };

    return {
      items:      (data.data ?? []).map((i) => ({ id: i.id, name: i.name ?? "" })),
      nextCursor: data.nextPageCursor ?? "",
    };
  }
  throw new Error("Roblox API rate-limit persisted after retries");
}

async function collectCategory(
  catKey: string,
  limit: number,
  sortType: string,
): Promise<{ id: number; name: string; link: string; category: string }[]> {
  const params = CATEGORY_PARAMS[catKey as keyof typeof CATEGORY_PARAMS];
  if (!params) return [];

  const results: { id: number; name: string; link: string; category: string }[] = [];
  const seen = new Set<number>();
  let cursor = "";

  while (results.length < limit) {
    const { items, nextCursor } = await fetchCatalogPage(params, sortType, cursor, limit - results.length);
    if (items.length === 0) break;

    for (const item of items) {
      if (!seen.has(item.id) && results.length < limit) {
        seen.add(item.id);
        results.push({
          id:       item.id,
          name:     item.name,
          link:     `https://www.roblox.com/catalog/${item.id}/${slugify(item.name)}`,
          category: catKey,
        });
      }
    }

    cursor = nextCursor;
    if (!cursor) break;
    await sleep(400);
  }

  return results;
}

// ─── Command definition ───────────────────────────────────────────────────────

export const flockCommand = new SlashCommandBuilder()
  .setName("flock")
  .setDescription("Project FlockLLM — collect Roblox marketplace data")
  .addSubcommand((sub) =>
    sub
      .setName("collect")
      .setDescription("Run data collection using current settings and receive a JSONL file"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Update per-category item limits and sort order")
      .addIntegerOption((o) => o.setName("all").setDescription("Items from the general catalog (0 = skip)").setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o) => o.setName("shirts").setDescription("Shirt items to collect").setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o) => o.setName("pants").setDescription("Pant items to collect").setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o) => o.setName("tshirts").setDescription("T-Shirt items to collect").setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o) => o.setName("accessories").setDescription("Accessory items to collect").setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o) => o.setName("bundles").setDescription("Bundle items to collect").setMinValue(0).setMaxValue(10000))
      .addIntegerOption((o) => o.setName("gear").setDescription("Gear items to collect").setMinValue(0).setMaxValue(10000))
      .addStringOption((o) =>
        o.setName("sort").setDescription("Sort order for all categories")
          .addChoices(
            { name: "Popular (most favorited)",  value: "popular"     },
            { name: "Best Selling",              value: "bestselling" },
            { name: "Recently Updated",          value: "recent"      },
            { name: "Recently Created",          value: "new"         },
            { name: "Relevance",                 value: "relevant"    },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("settings").setDescription("Show current FlockLLM collection settings"),
  );

// ─── Helpers ──────────────────────────────────────────────────────────────────

function settingsEmbed(s: FlockSettings, title: string): EmbedBuilder {
  const catLines = (Object.keys(CATEGORY_PARAMS) as (keyof typeof CATEGORY_PARAMS)[])
    .map((k) => {
      const n = s[k as keyof FlockSettings] as number;
      return `**${k}**: ${n === 0 ? "skip" : n.toLocaleString()}`;
    })
    .join("\n");

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🦜 Project FlockLLM — ${title}`)
    .addFields(
      { name: "Sort Order", value: s.sort,   inline: true },
      { name: "Total (if all active)", value: totalItems(s).toLocaleString(), inline: true },
      { name: "Per-Category Limits", value: catLines },
    )
    .setFooter({ text: "Use /flock set to change limits • /flock collect to run" });
}

function totalItems(s: FlockSettings): number {
  return (Object.keys(CATEGORY_PARAMS) as (keyof typeof CATEGORY_PARAMS)[])
    .reduce((sum, k) => sum + (s[k as keyof FlockSettings] as number), 0);
}

// ─── Subcommand handlers ──────────────────────────────────────────────────────

async function handleCollect(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings  = await loadSettings();
  const sortType  = SORT_TYPES[settings.sort] ?? "1";
  const cats      = Object.keys(CATEGORY_PARAMS) as (keyof typeof CATEGORY_PARAMS)[];
  const active    = cats.filter((k) => (settings[k as keyof FlockSettings] as number) > 0);

  if (active.length === 0) {
    await interaction.editReply({
      content: "All category limits are set to 0. Use `/flock set` to configure limits first.",
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("🦜 FlockLLM — Collection Running…")
        .setDescription(
          `Collecting from **${active.length}** categor${active.length !== 1 ? "ies" : "y"}.\n` +
          `Sort: **${settings.sort}** · This may take a few minutes.`,
        ),
    ],
  });

  try {
    const allItems: { id: number; name: string; link: string; category: string }[] = [];
    const seenIds  = new Set<number>();

    for (const cat of active) {
      const limit  = settings[cat as keyof FlockSettings] as number;
      logger.info({ cat, limit }, "FlockLLM: collecting category");
      const items  = await collectCategory(cat, limit, sortType);
      for (const item of items) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allItems.push(item);
        }
      }
      await sleep(300); // polite pause between categories
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename  = `flock-${timestamp}.jsonl`;
    const jsonl     = allItems.map((r) => JSON.stringify({ id: r.id, name: r.name, link: r.link })).join("\n");
    const buffer    = Buffer.from(jsonl, "utf-8");

    const catSummary = active
      .map((k) => `**${k}**: ${allItems.filter((i) => i.category === k).length.toLocaleString()}`)
      .join(" · ");

    const file  = new AttachmentBuilder(buffer, { name: filename });
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🦜 FlockLLM — Collection Complete")
      .addFields(
        { name: "Total Records",  value: allItems.length.toLocaleString(), inline: true },
        { name: "Sort",           value: settings.sort,                    inline: true },
        { name: "File",           value: filename,                         inline: true },
        { name: "By Category",    value: catSummary },
      )
      .setFooter({ text: "Format: { id, name, link } — one record per line (JSONL)" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], files: [file] });
  } catch (err) {
    logger.error({ err }, "FlockLLM collection failed");
    await interaction.editReply({
      content: `Collection failed: ${(err as Error).message}`,
    });
  }
}

async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await loadSettings();

  const fields: (keyof Omit<FlockSettings, "sort">)[] = [
    "all", "shirts", "pants", "tshirts", "accessories", "bundles", "gear",
  ];

  for (const field of fields) {
    const val = interaction.options.getInteger(field);
    if (val !== null) (settings as unknown as Record<string, unknown>)[field] = val;
  }

  const sort = interaction.options.getString("sort");
  if (sort) settings.sort = sort;

  await saveSettings(settings);

  await interaction.reply({
    embeds: [settingsEmbed(settings, "Settings Updated")],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await loadSettings();
  await interaction.reply({
    embeds: [settingsEmbed(settings, "Current Settings")],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function handleFlockCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!hasAccess(interaction)) {
    await interaction.reply({
      content: "You do not have access to Project FlockLLM.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "collect")  return handleCollect(interaction);
  if (sub === "set")      return handleSet(interaction);
  if (sub === "settings") return handleSettings(interaction);
}
