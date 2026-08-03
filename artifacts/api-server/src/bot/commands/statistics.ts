import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from "discord.js";
import { getFilings, getSheetUrl } from "../sheets";
import { logger } from "../../lib/logger";

export const statisticsCommand = new SlashCommandBuilder()
  .setName("statistics")
  .setDescription("Show filing statistics — total count, top professions, and recent entries");

export async function handleStatisticsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  try {
    const [filings, sheetUrl] = await Promise.all([getFilings(), getSheetUrl()]);

    if (filings.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📊 Filing Statistics")
        .setDescription("No filings have been submitted yet.\nUse `/filing` to add the first one!")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Profession breakdown
    const professionCounts: Record<string, number> = {};
    for (const f of filings) {
      const key = f.profession.trim() || "Unknown";
      professionCounts[key] = (professionCounts[key] ?? 0) + 1;
    }

    const topProfessions = Object.entries(professionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([prof, count], i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "▪️";
        return `${medal} **${prof}** — ${count} filing${count !== 1 ? "s" : ""}`;
      })
      .join("\n");

    // Last 5 filings (most recent first)
    const recent = filings
      .slice(-5)
      .reverse()
      .map((f) => {
        const date = f.timestamp ? new Date(f.timestamp).toLocaleDateString() : "?";
        return `**${f.username}** · \`${f.licensePlate}\` · ${f.profession} — <${date}>`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📊 Filing Statistics")
      .setURL(sheetUrl)
      .addFields(
        { name: "📁 Total Filings", value: `**${filings.length}**`, inline: true },
        {
          name: "🏷️ Unique Professions",
          value: `**${Object.keys(professionCounts).length}**`,
          inline: true,
        },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "🏆 Top Professions", value: topProfessions },
        { name: "🕐 Recent Filings", value: recent },
      )
      .setFooter({ text: `Click the title to open the full spreadsheet` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to load statistics");
    await interaction.editReply({
      content: "❌ Could not load statistics. Please try again.",
    });
  }
}
