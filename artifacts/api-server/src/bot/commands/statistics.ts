import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { getFilings, getSheetUrl, type FilingRecord } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const statisticsCommand = new SlashCommandBuilder()
  .setName("statistics")
  .setDescription("Show filing statistics — totals, recent trends, and seized item breakdown");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse seized string "2x Hawthorne M80, 1x Jarniwus" → Map of item → total qty */
function parseSeized(raw: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw?.trim() || raw.trim().toLowerCase() === "none") return out;
  for (const part of raw.split(",")) {
    const match = part.trim().match(/^(\d+)x\s+(.+)$/i);
    if (match) {
      const qty = parseInt(match[1], 10);
      const name = match[2].trim();
      out.set(name, (out.get(name) ?? 0) + qty);
    }
  }
  return out;
}

/** Merge multiple item maps into one. */
function mergeItemMaps(maps: Map<string, number>[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const m of maps) {
    for (const [k, v] of m) result.set(k, (result.get(k) ?? 0) + v);
  }
  return result;
}

/** Format a sorted item map as a display string, capped at `limit` entries. */
function formatItemMap(items: Map<string, number>, limit = 8): string {
  const sorted = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return sorted.map(([name, count]) => `${name} — ${count}`).join("\n");
}

/**
 * Try to get a filing's submission timestamp as a Date.
 * Uses the bot-recorded `timestamp` (ISO string) which is always reliable.
 * Falls back to parsing `dateOfIncident` as a last resort.
 */
function filingDate(f: FilingRecord): Date | null {
  if (f.timestamp) {
    const d = new Date(f.timestamp);
    if (!isNaN(d.getTime())) return d;
  }
  if (f.dateOfIncident) {
    const d = new Date(f.dateOfIncident);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// ─── Command handler ──────────────────────────────────────────────────────────

export async function handleStatisticsCommand(
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

  await interaction.deferReply();

  try {
    const [filings, sheetUrl] = await Promise.all([getFilings(), getSheetUrl()]);

    if (filings.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("Filing Statistics")
            .setDescription("No filings have been submitted yet.\nUse `/filing` to add the first one.")
            .setTimestamp(),
        ],
      });
      return;
    }

    // ── All-time seized aggregation ──────────────────────────────────────────
    const allItemMaps = filings.map((f) => parseSeized(f.seized ?? ""));
    const allTimeTotals = mergeItemMaps(allItemMaps);
    const totalSeizedFilings = filings.filter((f) => f.seized?.trim()).length;

    // ── Last-7-days window ───────────────────────────────────────────────────
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentFilings = filings.filter((f) => {
      const d = filingDate(f);
      return d !== null && d >= cutoff;
    });

    const recentItemMaps = recentFilings.map((f) => parseSeized(f.seized ?? ""));
    const recentTotals = mergeItemMaps(recentItemMaps);

    // ── Recent filings list (last 5, newest first) ───────────────────────────
    const recentList = filings
      .slice(-5)
      .reverse()
      .map((f) => `**${f.username || "?"}** | ${f.dateOfIncident || "?"}`)
      .join("\n");

    // ── Build embed ──────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Filing Statistics")
      .setURL(sheetUrl)
      .addFields(
        // Row 1 — headline numbers
        { name: "Total Filings", value: `${filings.length}`, inline: true },
        { name: "With Seized Items", value: `${totalSeizedFilings}`, inline: true },
        { name: "Last 7 Days", value: `${recentFilings.length} filing${recentFilings.length !== 1 ? "s" : ""}`, inline: true },
      );

    // All-time seized breakdown
    if (allTimeTotals.size > 0) {
      embed.addFields({
        name: "Top Seized Items (All Time)",
        value: formatItemMap(allTimeTotals),
      });
    }

    // Last-7-days seized breakdown — only show if there's data
    if (recentTotals.size > 0) {
      embed.addFields({
        name: "Seized Items — Last 7 Days",
        value: formatItemMap(recentTotals),
      });
    } else {
      embed.addFields({
        name: "Seized Items — Last 7 Days",
        value: recentFilings.length > 0
          ? "No seized items recorded this week."
          : "No filings in the last 7 days.",
      });
    }

    // Recent filings list
    embed.addFields({ name: "Recent Filings", value: recentList });

    embed
      .setFooter({ text: "Click the title to open the full spreadsheet" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to load statistics");
    await interaction.editReply({
      content: "Could not load statistics. Please try again.",
    });
  }
}
