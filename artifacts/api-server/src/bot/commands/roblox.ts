import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import {
  getUserByUsername,
  getAvatarUrl,
  checkGroupMembership,
  getUserGroups,
  profileUrl,
} from "../roblox";
import { setVerification, getVerification, removeVerification } from "../verifications";
import { getAllowedUsers, checkAccess } from "../access";
import { logger } from "../../lib/logger";

export const robloxCommand = new SlashCommandBuilder()
  .setName("roblox")
  .setDescription("Roblox user lookup, group check, and verification")
  .addSubcommand((sub) =>
    sub
      .setName("lookup")
      .setDescription("Look up a Roblox user by username")
      .addStringOption((opt) =>
        opt.setName("username").setDescription("Roblox username").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("group")
      .setDescription("Check if a Roblox user is in a specific group")
      .addStringOption((opt) =>
        opt.setName("username").setDescription("Roblox username").setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt.setName("group_id").setDescription("Roblox group ID").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("verify")
      .setDescription("Link a Discord member to their Roblox account")
      .addUserOption((opt) =>
        opt.setName("member").setDescription("Discord member to verify").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("username").setDescription("Their Roblox username").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("unverify")
      .setDescription("Remove a Discord member's Roblox verification")
      .addUserOption((opt) =>
        opt.setName("member").setDescription("Discord member to unverify").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("whois")
      .setDescription("Look up which Roblox account a Discord member is verified as")
      .addUserOption((opt) =>
        opt.setName("member").setDescription("Discord member to look up").setRequired(true),
      ),
  );

export async function handleRobloxCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  // verify, unverify, whois require access; lookup and group are open
  if (["verify", "unverify"].includes(sub)) {
    const allowed = await getAllowedUsers();
    if (!checkAccess(interaction, allowed)) {
      await interaction.reply({
        content: "You do not have access to this command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    if (sub === "lookup") await handleLookup(interaction);
    else if (sub === "group") await handleGroup(interaction);
    else if (sub === "verify") await handleVerify(interaction);
    else if (sub === "unverify") await handleUnverify(interaction);
    else if (sub === "whois") await handleWhois(interaction);
  } catch (err) {
    logger.error({ err }, "Error handling /roblox command");
    const reply = { content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply);
    else await interaction.reply(reply);
  }
}

async function handleLookup(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const username = interaction.options.getString("username", true);

  const user = await getUserByUsername(username);
  if (!user) {
    await interaction.editReply({ content: `No Roblox user found with username **${username}**.` });
    return;
  }

  const avatarUrl = await getAvatarUrl(user.id);
  const joinDate = new Date(user.created).toLocaleDateString();

  const embed = new EmbedBuilder()
    .setColor(0xe8000b)
    .setTitle(user.displayName !== user.name ? `${user.displayName} (@${user.name})` : user.name)
    .setURL(profileUrl(user.id))
    .setDescription(user.description || "No description set.")
    .addFields(
      { name: "User ID", value: `${user.id}`, inline: true },
      { name: "Joined Roblox", value: joinDate, inline: true },
      { name: "Status", value: user.isBanned ? "Banned" : "Active", inline: true },
    )
    .setFooter({ text: "Click the name to open Roblox profile" });

  if (avatarUrl) embed.setThumbnail(avatarUrl);

  await interaction.editReply({ embeds: [embed] });
}

async function handleGroup(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const username = interaction.options.getString("username", true);
  const groupId = interaction.options.getInteger("group_id", true);

  const user = await getUserByUsername(username);
  if (!user) {
    await interaction.editReply({ content: `No Roblox user found with username **${username}**.` });
    return;
  }

  const membership = await checkGroupMembership(user.id, groupId);

  const embed = new EmbedBuilder()
    .setTitle(`Group Membership — ${user.name}`)
    .setURL(profileUrl(user.id));

  if (membership) {
    embed
      .setColor(0x57f287)
      .setDescription(`**${user.name}** is a member of **${membership.group.name}**.`)
      .addFields(
        { name: "Role", value: membership.role.name, inline: true },
        { name: "Rank", value: `${membership.role.rank}`, inline: true },
        { name: "Group Members", value: `${membership.group.memberCount}`, inline: true },
      );
  } else {
    embed
      .setColor(0xed4245)
      .setDescription(`**${user.name}** is not a member of group ID **${groupId}**.`);
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = interaction.options.getUser("member", true);
  const username = interaction.options.getString("username", true);

  const user = await getUserByUsername(username);
  if (!user) {
    await interaction.editReply({ content: `No Roblox user found with username **${username}**.` });
    return;
  }

  await setVerification(member.id, user.id, user.name, interaction.user.tag);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Verification Saved")
    .addFields(
      { name: "Discord Member", value: `<@${member.id}>`, inline: true },
      { name: "Roblox Account", value: `[${user.name}](${profileUrl(user.id)})`, inline: true },
      { name: "Roblox ID", value: `${user.id}`, inline: true },
    )
    .setFooter({ text: `Verified by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleUnverify(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.options.getUser("member", true);
  const removed = await removeVerification(member.id);

  if (removed) {
    await interaction.reply({
      content: `Verification removed for <@${member.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: `<@${member.id}> has no verification on record.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleWhois(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const member = interaction.options.getUser("member", true);
  const record = await getVerification(member.id);

  if (!record) {
    await interaction.editReply({
      content: `<@${member.id}> has not been verified yet.`,
    });
    return;
  }

  const verifiedDate = new Date(record.verifiedAt).toLocaleDateString();
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Verification Record")
    .addFields(
      { name: "Discord Member", value: `<@${member.id}>`, inline: true },
      {
        name: "Roblox Account",
        value: `[${record.robloxUsername}](${profileUrl(record.robloxId)})`,
        inline: true,
      },
      { name: "Roblox ID", value: `${record.robloxId}`, inline: true },
      { name: "Verified On", value: verifiedDate, inline: true },
      { name: "Verified By", value: record.verifiedBy, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
