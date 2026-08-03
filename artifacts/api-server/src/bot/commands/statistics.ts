import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from "discord.js";
import { getFilings, getSheetUrl } from "../sheets";
import { getAllowedUsers, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const statisticsCommand = new SlashCommandBuilder()
  .setName("statistics")
  .setDescription("Show filing statistics — total count, top possessions, and recent entries");

export async function handleStatisticsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const allowed = await getAllowedUsers();
  if (!checkAccess(interaction, allowed)) {
    await interaction.reply({
      content: "You do not have access to this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const [filings, sheetUrl] = await Promise.all([getFilings(), getSheetUrl()]);

    if (filings.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Filing Statistics")
        .setDescription("No filings have been submitted yet.\nUse `/filing` to add the first one.")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Possession breakdown
    const possessionCounts: Record<string, number> = {};
    for (const f of filings) {
      const key = f.profession.trim() || "Unknown";
      possessionCounts[key] = (possessionCounts[key] ?? 0) + 1;
    }

    const topPossessions = Object.entries(possessionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([possession, count]) => `${possession} — ${count} filing${count !== 1 ? "s" : ""}`)
      .join("\n");

    // Last 5 filings (most recent first)
    const recent = filings
      .slice(-5)
      .reverse()
      .map((f) => {
        const date = f.timestamp ? new Date(f.timestamp).toLocaleDateString() : "?";
        return `${f.username} | ${f.licensePlate} | ${f.profession} | ${date}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Filing Statistics")
      .setURL(sheetUrl)
      .addFields(
        { name: "Total Filings", value: `${filings.length}`, inline: true },
        {
          name: "Unique Possessions",
          value: `${Object.keys(possessionCounts).length}`,
          inline: true,
        },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "Top Possessions", value: topPossessions },
        { name: "Recent Filings", value: recent },
      )
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
