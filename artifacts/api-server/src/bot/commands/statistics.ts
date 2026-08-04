import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { getFilings, getSheetUrl, type FilingRecord } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const statisticsCommand = new SlashCommandBuilder()
  .setName("statistics")
  .setDescription("Show filing statistics — totals, daily trend, and seized item breakdown");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "2x Hawthorne M80, 1x Jarniwus" → Map<item, total qty> */
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

function mergeItemMaps(maps: Map<string, number>[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const m of maps) for (const [k, v] of m) result.set(k, (result.get(k) ?? 0) + v);
  return result;
}

/** Format top-N items from a map as "Item — count\n..." */
function formatItemMap(items: Map<string, number>, limit = 8): string {
  return [...items.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} — ${count}`)
    .join("\n");
}

/** UTC date string "YYYY-MM-DD" for a given Date, used as bucket key. */
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Short display label for a date key, e.g. "Aug 04 (Sun)". */
function formatDateKey(key: string): string {
  const d = new Date(`${key}T12:00:00Z`); // noon UTC avoids DST edge cases
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    weekday: "short",
    timeZone: "UTC",
  });
}

/**
 * Return the bot-recorded submission timestamp as a Date.
 * Falls back to dateOfIncident if timestamp is absent/unparseable.
 */
function filingDate(f: FilingRecord): Date | null {
  for (const raw of [f.timestamp, f.dateOfIncident]) {
    if (!raw) continue;
    const d = new Date(raw);
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
    const allTimeTotals = mergeItemMaps(filings.map((f) => parseSeized(f.seized ?? "")));
    const totalSeizedFilings = filings.filter((f) => f.seized?.trim()).length;

    // ── Build 7-day buckets (today back through 6 days ago, UTC) ─────────────
    const now = new Date();
    const bucketKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      bucketKeys.push(toDateKey(d));
    }

    // Map each bucket key → { count, seized items }
    const bucketCounts = new Map<string, number>(bucketKeys.map((k) => [k, 0]));
    const bucketSeized = new Map<string, Map<string, number>>(
      bucketKeys.map((k) => [k, new Map()]),
    );

    for (const filing of filings) {
      const d = filingDate(filing);
      if (!d) continue;
      const key = toDateKey(d);
      if (!bucketCounts.has(key)) continue; // outside our 7-day window
      bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
      const merged = mergeItemMaps([
        bucketSeized.get(key)!,
        parseSeized(filing.seized ?? ""),
      ]);
      bucketSeized.set(key, merged);
    }

    // ── Format daily trend ───────────────────────────────────────────────────
    const trendLines = bucketKeys.map((key) => {
      const count = bucketCounts.get(key) ?? 0;
      const items = bucketSeized.get(key)!;
      const label = formatDateKey(key);
      const countStr = count === 0 ? "—" : `${count} filing${count !== 1 ? "s" : ""}`;

      if (items.size === 0) return `\`${label}\`  ${countStr}`;

      // Show the single top seized item inline for quick spike reading
      const [topItem, topQty] = [...items.entries()].sort((a, b) => b[1] - a[1])[0];
      const spikeHint = items.size > 1
        ? `${topQty}× ${topItem} (+${items.size - 1} more)`
        : `${topQty}× ${topItem}`;
      return `\`${label}\`  ${countStr} · ${spikeHint}`;
    });

    const weekTotal = [...bucketCounts.values()].reduce((a, b) => a + b, 0);

    // ── Recent filings list (last 5, newest first) ────────────────────────────
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
        { name: "Total Filings", value: `${filings.length}`, inline: true },
        { name: "With Seized Items", value: `${totalSeizedFilings}`, inline: true },
        { name: "Last 7 Days", value: `${weekTotal} filing${weekTotal !== 1 ? "s" : ""}`, inline: true },
        {
          name: "Daily Breakdown — Last 7 Days",
          value: trendLines.join("\n"),
        },
      );

    if (allTimeTotals.size > 0) {
      embed.addFields({
        name: "Top Seized Items (All Time)",
        value: formatItemMap(allTimeTotals),
      });
    }

    embed
      .addFields({ name: "Recent Filings", value: recentList })
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
