import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { grantAccess, revokeAccess, getAllowedUsers } from "../access";
import { logger } from "../../lib/logger";

export const accessCommand = new SlashCommandBuilder()
  .setName("access")
  .setDescription("Manage who can use bot commands")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("give")
      .setDescription("Grant a user access to bot commands")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to grant access to").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Revoke a user's access to bot commands")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to revoke access from").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all users who have been granted access"),
  );

export async function handleAccessCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "give") {
      const user = interaction.options.getUser("user", true);
      await grantAccess(user.id);
      await interaction.reply({
        content: `Access granted to ${user.tag}.`,
        ephemeral: true,
      });
    } else if (sub === "remove") {
      const user = interaction.options.getUser("user", true);
      await revokeAccess(user.id);
      await interaction.reply({
        content: `Access revoked from ${user.tag}.`,
        ephemeral: true,
      });
    } else if (sub === "list") {
      const users = await getAllowedUsers();
      if (users.size === 0) {
        await interaction.reply({
          content:
            "No users have been explicitly granted access. Server administrators always have access.",
          ephemeral: true,
        });
      } else {
        const list = [...users].map((id) => `<@${id}>`).join(", ");
        await interaction.reply({
          content: `Users with access: ${list}\n\nServer administrators always have access regardless of this list.`,
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to handle access command");
    await interaction.reply({
      content: "Something went wrong. Please try again.",
      ephemeral: true,
    });
  }
}
