import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { getFilings, getSheetUrl } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const statisticsCommand = new SlashCommandBuilder()
  .setName("statistics")
  .setDescription("Show filing statistics — total count, top possessions, and recent entries");

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
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Filing Statistics")
        .setDescription("No filings have been submitted yet.\nUse `/filing` to add the first one.")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Officer breakdown
    const officerCounts: Record<string, number> = {};
    for (const f of filings) {
      const key = f.peaceOfficer.trim() || "Unknown";
      officerCounts[key] = (officerCounts[key] ?? 0) + 1;
    }

    const topOfficers = Object.entries(officerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([officer, count]) => `${officer} — ${count} filing${count !== 1 ? "s" : ""}`)
      .join("\n");

    // Last 5 filings (most recent first)
    const recent = filings
      .slice(-5)
      .reverse()
      .map((f) => {
        const date = f.dateOfIncident || (f.timestamp ? new Date(f.timestamp).toLocaleDateString() : "?");
        return `${f.username} | ${f.licensePlate} | ${date} | ${f.peaceOfficer}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Filing Statistics")
      .setURL(sheetUrl)
      .addFields(
        { name: "Total Filings", value: `${filings.length}`, inline: true },
        {
          name: "Unique Officers",
          value: `${Object.keys(officerCounts).length}`,
          inline: true,
        },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "Top Officers", value: topOfficers },
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
