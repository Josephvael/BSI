import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { getFilings, getSheetUrl, type FilingRecord } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const statisticsCommand = new SlashCommandBuilder()
  .setName("statistics")
  .setDescription("Show filing statistics — totals, trend breakdown, and seized item summary")
  .addStringOption((opt) =>
    opt
      .setName("window")
      .setDescription("Time window for the trend breakdown (default: 7d)")
      .setRequired(false)
      .addChoices(
        { name: "Last 7 Days", value: "7d" },
        { name: "Last 30 Days", value: "30d" },
      ),
  );

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "2x Hawthorne M80\n1x Jarniwus" or "2x Hawthorne M80, 1x Jarniwus" → Map */
function parseSeized(raw: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw?.trim() || raw.trim().toLowerCase() === "none") return out;
  // Support both comma-separated and newline-separated formats
  const parts = raw.split(/[,\n]+/);
  for (const part of parts) {
    const match = part.trim().match(/^(\d+)\s*x\s+(.+)$/i);
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

function formatItemMap(items: Map<string, number>, limit = 8): string {
  return [...items.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} — ${count}`)
    .join("\n");
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function formatDateKey(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short", day: "2-digit", weekday: "short", timeZone: "UTC",
  });
}

/** Short "Aug 04" label for week-bucket range endpoints. */
function formatShortDate(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function filingDate(f: FilingRecord): Date | null {
  for (const raw of [f.timestamp, f.dateOfIncident]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Format one trend row — daily or weekly. */
function trendLine(label: string, count: number, seized: Map<string, number>): string {
  const countStr = count === 0 ? "—" : `${count} filing${count !== 1 ? "s" : ""}`;
  if (seized.size === 0) return `\`${label}\`  ${countStr}`;
  const [topItem, topQty] = [...seized.entries()].sort((a, b) => b[1] - a[1])[0];
  const hint = seized.size > 1 ? `${topQty}× ${topItem} (+${seized.size - 1} more)` : `${topQty}× ${topItem}`;
  return `\`${label}\`  ${countStr} · ${hint}`;
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
    const windowOpt = (interaction.options.getString("window") ?? "7d") as "7d" | "30d";
    const days = windowOpt === "30d" ? 30 : 7;

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

    // ── Build daily buckets for the chosen window ─────────────────────────────
    const now = new Date();
    const dailyKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      dailyKeys.push(toDateKey(d));
    }

    const dailyCounts = new Map<string, number>(dailyKeys.map((k) => [k, 0]));
    const dailySeized = new Map<string, Map<string, number>>(dailyKeys.map((k) => [k, new Map()]));

    for (const filing of filings) {
      const d = filingDate(filing);
      if (!d) continue;
      const key = toDateKey(d);
      if (!dailyCounts.has(key)) continue;
      dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
      dailySeized.set(key, mergeItemMaps([dailySeized.get(key)!, parseSeized(filing.seized ?? "")]));
    }

    const windowTotal = [...dailyCounts.values()].reduce((a, b) => a + b, 0);

    // ── Format trend lines ────────────────────────────────────────────────────
    let trendLines: string[];
    let trendTitle: string;

    if (windowOpt === "7d") {
      // Daily rows for 7-day view
      trendLines = dailyKeys.map((key) =>
        trendLine(formatDateKey(key), dailyCounts.get(key) ?? 0, dailySeized.get(key)!),
      );
      trendTitle = "Daily Breakdown — Last 7 Days";
    } else {
      // Proper 7-day buckets for 30-day view.
      // 30 days = four 7-day buckets + one 2-day partial bucket at the end.
      // Partial buckets are labeled with their actual day count so staff aren't misled.
      // Verification: sum of bucket sizes = 7+7+7+7+2 = 30 = days ✓
      const weekBuckets: { label: string; count: number; seized: Map<string, number> }[] = [];
      let i = 0;
      while (i < days) {
        const bucketDays = dailyKeys.slice(i, i + 7);
        const isPartial = bucketDays.length < 7;
        const startLabel = formatShortDate(bucketDays[0]);
        const endLabel = formatShortDate(bucketDays[bucketDays.length - 1]);
        const rangeLabel = isPartial
          ? `${startLabel}–${endLabel} (${bucketDays.length}d)`
          : `${startLabel}–${endLabel}`;
        const count = bucketDays.reduce((s, k) => s + (dailyCounts.get(k) ?? 0), 0);
        const seized = mergeItemMaps(bucketDays.map((k) => dailySeized.get(k)!));
        weekBuckets.push({ label: rangeLabel, count, seized });
        i += 7;
      }
      trendLines = weekBuckets.map((b) => trendLine(b.label, b.count, b.seized));
      trendTitle = "Weekly Breakdown — Last 30 Days";
    }

    // ── Recent filings list (last 5, newest first) ────────────────────────────
    const recentList = filings
      .slice(-5)
      .reverse()
      .map((f) => `**${f.username || "?"}** | ${f.dateOfIncident || "?"}`)
      .join("\n");

    // ── Build embed ──────────────────────────────────────────────────────────
    const windowLabel = windowOpt === "7d" ? "Last 7 Days" : "Last 30 Days";

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Filing Statistics")
      .setURL(sheetUrl)
      .addFields(
        { name: "Total Filings", value: `${filings.length}`, inline: true },
        { name: "With Seized Items", value: `${totalSeizedFilings}`, inline: true },
        { name: windowLabel, value: `${windowTotal} filing${windowTotal !== 1 ? "s" : ""}`, inline: true },
        { name: trendTitle, value: trendLines.join("\n") },
      );

    if (allTimeTotals.size > 0) {
      embed.addFields({ name: "Top Seized Items (All Time)", value: formatItemMap(allTimeTotals) });
    }

    embed
      .addFields({ name: "Recent Filings", value: recentList })
      .setFooter({ text: "Click the title to open the full spreadsheet" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to load statistics");
    await interaction.editReply({ content: "Could not load statistics. Please try again." });
  }
}
