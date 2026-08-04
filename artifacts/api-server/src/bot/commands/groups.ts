import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { addGroup, removeGroup, getGroups } from "../groupRegistry";
import { getAllowedRoles, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const groupsCommand = new SlashCommandBuilder()
  .setName("groups")
  .setDescription("Manage the Roblox groups that /search checks automatically")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a Roblox group to the search list")
      .addIntegerOption((opt) =>
        opt.setName("group_id").setDescription("Roblox group ID").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("label")
          .setDescription("Friendly name for this group (e.g. Main Gang, Police Dept)")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a Roblox group from the search list")
      .addIntegerOption((opt) =>
        opt.setName("group_id").setDescription("Roblox group ID to remove").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all registered Roblox groups"),
  );

export async function handleGroupsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  // add and remove require access; list is open
  if (sub === "add" || sub === "remove") {
    const allowed = await getAllowedRoles();
    if (!checkAccess(interaction, allowed)) {
      await interaction.reply({
        content: "You do not have access to this command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    if (sub === "add") {
      const groupId = interaction.options.getInteger("group_id", true);
      const label = interaction.options.getString("label", true);
      const result = await addGroup(groupId, label, interaction.user.tag);

      if (!result.added) {
        await interaction.reply({
          content: `Group ID **${groupId}** is already registered as **${result.existing!.label}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `Group **${label}** (ID: ${groupId}) added. It will now be checked in every \`/search\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === "remove") {
      const groupId = interaction.options.getInteger("group_id", true);
      const removed = await removeGroup(groupId);

      if (!removed) {
        await interaction.reply({
          content: `Group ID **${groupId}** is not in the list.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `Group ID **${groupId}** removed from the search list.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === "list") {
      const groups = await getGroups();

      if (groups.length === 0) {
        await interaction.reply({
          content: "No groups registered yet. Use `/groups add` to add one.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Registered Roblox Groups")
        .setDescription("These groups are checked automatically in every `/search`.")
        .addFields(
          groups.map((g) => ({
            name: `${g.label}`,
            value: `Group ID: \`${g.id}\` — Added by ${g.addedBy}`,
            inline: false,
          })),
        )
        .setFooter({ text: `${groups.length} group${groups.length !== 1 ? "s" : ""} registered` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err }, "Error handling /groups command");
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: "Something went wrong. Please try again." });
    } else {
      await interaction.reply({ content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral });
    }
  }
}
