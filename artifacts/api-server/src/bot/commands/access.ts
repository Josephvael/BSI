import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { grantRoleAccess, revokeRoleAccess, getAllowedRoles } from "../access";
import { logger } from "../../lib/logger";

export const accessCommand = new SlashCommandBuilder()
  .setName("access")
  .setDescription("Manage which roles can use bot commands")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("give")
      .setDescription("Grant a role access to bot commands")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Role to grant access to").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Revoke a role's access to bot commands")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Role to revoke access from").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all roles that have been granted access"),
  );

export async function handleAccessCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "give") {
      const role = interaction.options.getRole("role", true);
      await grantRoleAccess(role.id);
      await interaction.reply({
        content: `Access granted to <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === "remove") {
      const role = interaction.options.getRole("role", true);
      await revokeRoleAccess(role.id);
      await interaction.reply({
        content: `Access revoked from <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === "list") {
      const roles = await getAllowedRoles();
      if (roles.size === 0) {
        await interaction.reply({
          content: "No roles have been granted access. Server administrators always have access.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        const list = [...roles].map((id) => `<@&${id}>`).join(", ");
        await interaction.reply({
          content: `Roles with access: ${list}\n\nServer administrators always have access regardless of this list.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to handle access command");
    await interaction.reply({
      content: "Something went wrong. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
