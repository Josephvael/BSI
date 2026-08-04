import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { getUserByUsername, getAvatarUrl, checkGroupMembership, profileUrl } from "../roblox";
import { getGroups } from "../groupRegistry";
import { getFilings, getSheetUrl } from "../sheets";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";
import { matchFilings } from "./search-match";

export const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Look up a Roblox user and check all registered group memberships")
  .addStringOption((opt) =>
    opt.setName("username").setDescription("Roblox username to search").setRequired(true),
  );

export async function handleSearchCommand(
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

  const username = interaction.options.getString("username", true);

  try {
    // Fetch user, registered groups, and filing history in parallel
    const [user, groups, filingsResult, sheetUrl] = await Promise.all([
      getUserByUsername(username),
      getGroups(),
      getFilings(),
      getSheetUrl(),
    ]);

    const allFilings = filingsResult.records;
    // Use the actual cache timestamp so "Last updated" reflects when Sheets was last queried
    const fetchedAt = Math.floor(filingsResult.fetchedAt / 1000);

    if (!user) {
      await interaction.editReply({
        content: `No Roblox user found with username **${username}**.`,
      });
      return;
    }

    // Fetch avatar and all group memberships in parallel
    const [avatarUrl, ...memberships] = await Promise.all([
      getAvatarUrl(user.id),
      ...groups.map((g) => checkGroupMembership(user.id, g.id)),
    ]);

    const joinDate = new Date(user.created).toLocaleDateString();

    const embed = new EmbedBuilder()
      .setColor(0xe8000b)
      .setTitle(
        user.displayName !== user.name
          ? `${user.displayName} (@${user.name})`
          : user.name,
      )
      .setURL(profileUrl(user.id))
      .setDescription(user.description || "No description set.")
      .addFields(
        { name: "User ID", value: `${user.id}`, inline: true },
        { name: "Joined Roblox", value: joinDate, inline: true },
        { name: "Account Status", value: user.isBanned ? "Banned" : "Active", inline: true },
      );

    if (avatarUrl) embed.setThumbnail(avatarUrl);

    // Group membership section
    if (groups.length === 0) {
      embed.addFields({
        name: "Group Memberships",
        value: "No groups registered. Use `/groups add` to add groups to check.",
        inline: false,
      });
    } else {
      const memberLines: string[] = [];
      const nonMemberLines: string[] = [];

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const membership = memberships[i];

        if (membership) {
          memberLines.push(
            `**${group.label}** — ${membership.role.name} (Rank ${membership.role.rank})`,
          );
        } else {
          nonMemberLines.push(`**${group.label}** — Not a member`);
        }
      }

      const allLines = [...memberLines, ...nonMemberLines];

      embed.addFields({
        name: `Group Memberships (${memberLines.length}/${groups.length} matched)`,
        value: allLines.join("\n"),
        inline: false,
      });
    }

    // Filing history section — exact match first, then partial/contains near-matches
    const { exact: exactFilings, near: nearFilings } = matchFilings(allFilings, username);

    if (exactFilings.length === 0 && nearFilings.length === 0) {
      embed.addFields({
        name: "Filing History",
        value: `No filings on record.\n-# Last updated: <t:${fetchedAt}:R>`,
        inline: false,
      });
    } else {
      const filingLines: string[] = [];

      if (exactFilings.length > 0) {
        // Most recent first (last rows in sheet = most recent)
        const recent = exactFilings.slice(-5).reverse();
        const lines = recent.map((f) => `• **${f.dateOfIncident}** — ${f.seized}`);
        if (exactFilings.length > 5) {
          lines.push(`[View all ${exactFilings.length} filings](${sheetUrl})`);
        }
        filingLines.push(...lines);
      } else {
        filingLines.push("No exact matches on record.");
      }

      if (nearFilings.length > 0) {
        filingLines.push("\n**Possible matches**");
        const recentNear = nearFilings.slice(-5).reverse();
        const nearLines = recentNear.map(
          (f) => `• **${f.dateOfIncident}** — ${f.seized} *(stored as: ${f.username})*`,
        );
        if (nearFilings.length > 5) {
          nearLines.push(`[View all ${nearFilings.length} near-matches](${sheetUrl})`);
        }
        filingLines.push(...nearLines);
      }

      filingLines.push(`-# Last updated: <t:${fetchedAt}:R>`);

      const totalExact = exactFilings.length;
      const totalNear = nearFilings.length;
      const headerLabel =
        totalNear > 0
          ? `Filing History (${totalExact} exact, ${totalNear} possible)`
          : `Filing History (${totalExact} total)`;

      embed.addFields({
        name: headerLabel,
        value: filingLines.join("\n"),
        inline: false,
      });
    }

    embed
      .setFooter({ text: "Click the name to open Roblox profile" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Error handling /search command");
    await interaction.editReply({ content: "Something went wrong. Please try again." });
  }
}
