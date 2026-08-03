import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from "discord.js";
import { getUserByUsername, getAvatarUrl, checkGroupMembership, profileUrl } from "../roblox";
import { getGroups } from "../groupRegistry";
import { logger } from "../../lib/logger";

export const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Look up a Roblox user and check all registered group memberships")
  .addStringOption((opt) =>
    opt.setName("username").setDescription("Roblox username to search").setRequired(true),
  );

export async function handleSearchCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const username = interaction.options.getString("username", true);

  try {
    // Fetch user and registered groups in parallel
    const [user, groups] = await Promise.all([
      getUserByUsername(username),
      getGroups(),
    ]);

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

    embed
      .setFooter({ text: "Click the name to open Roblox profile" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Error handling /search command");
    await interaction.editReply({ content: "Something went wrong. Please try again." });
  }
}
