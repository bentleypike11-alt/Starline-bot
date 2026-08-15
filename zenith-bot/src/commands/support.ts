import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { api } from "../lib/api.js";
import { config } from "../lib/config.js";
import { successEmbed, errorEmbed, infoEmbed } from "../lib/embed.js";

const SUPPORT_SERVER_ID = config.supportServerId;
const OWNER_IDS = ["961048718612774922"];

export const data = new SlashCommandBuilder()
  .setName("support")
  .setDescription("[Zenith Support] Support server admin commands")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub =>
    sub.setName("premium-grant")
      .setDescription("Grant premium to a server")
      .addStringOption(o => o.setName("guild_id").setDescription("Server ID").setRequired(true))
      .addIntegerOption(o => o.setName("days").setDescription("Days (default 30)").setMinValue(1).setMaxValue(365))
  )
  .addSubcommand(sub =>
    sub.setName("premium-revoke")
      .setDescription("Revoke premium from a server")
      .addStringOption(o => o.setName("guild_id").setDescription("Server ID").setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName("premium-check")
      .setDescription("Check premium status of a server")
      .addStringOption(o => o.setName("guild_id").setDescription("Server ID").setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName("stats")
      .setDescription("View Zenith global statistics")
  )
  .addSubcommand(sub =>
    sub.setName("announce")
      .setDescription("Queue a global announcement (owner only)")
      .addStringOption(o => o.setName("message").setDescription("Announcement text").setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.guildId !== SUPPORT_SERVER_ID) {
    await interaction.reply({ content: "❌ This command is only available in the Zenith support server.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const sub     = interaction.options.getSubcommand();
  const isOwner = OWNER_IDS.includes(interaction.user.id);
  try {
    if (sub === "premium-grant") {
      if (!isOwner) { await interaction.editReply({ embeds: [errorEmbed("Unauthorized", "Only Zenith owners can grant premium.")] }); return; }
      const guildId = interaction.options.getString("guild_id", true);
      const days    = interaction.options.getInteger("days") ?? 30;
      const res = await api.premium.give(guildId, days);
      await interaction.editReply({ embeds: [successEmbed("Premium Granted ⭐",
        `\`${guildId}\` now has **${days} days** of Zenith Premium.\nExpires: **${new Date(res.expiresAt).toLocaleDateString()}**`
      )] });
    } else if (sub === "premium-revoke") {
      if (!isOwner) { await interaction.editReply({ embeds: [errorEmbed("Unauthorized", "Only Zenith owners can revoke premium.")] }); return; }
      const guildId = interaction.options.getString("guild_id", true);
      await api.premium.revoke(guildId);
      await interaction.editReply({ embeds: [successEmbed("Premium Revoked", `Premium revoked for \`${guildId}\`.`)] });
    } else if (sub === "premium-check") {
      const guildId = interaction.options.getString("guild_id", true);
      const res = await api.premium.check(guildId);
      await interaction.editReply({ embeds: [infoEmbed(`Premium Status — ${guildId}`,
        res.isPremium
          ? `✅ **Premium Active**`
          : "❌ No active premium"
      )] });
    } else if (sub === "stats") {
      const res = await api.get("/admin/stats");
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json() as any;
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle("📊 Zenith Global Stats")
        .setColor(0xd4af37)
        .addFields(
          { name: "Servers",     value: String(d.totalGuilds    ?? 0), inline: true },
          { name: "Premium",     value: String(d.premiumGuilds  ?? 0), inline: true },
          { name: "Total Staff", value: String(d.totalStaff     ?? 0), inline: true },
          { name: "Strikes",     value: String(d.totalStrikes   ?? 0), inline: true },
          { name: "Warnings",    value: String(d.totalWarnings  ?? 0), inline: true },
          { name: "Active LOAs", value: String(d.totalActiveLoa ?? 0), inline: true },
        )
        .setTimestamp().setFooter({ text: "Zenith Staff Management" })
      ] });
    } else if (sub === "announce") {
      if (!isOwner) { await interaction.editReply({ embeds: [errorEmbed("Unauthorized", "Only Zenith owners can send announcements.")] }); return; }
      const message = interaction.options.getString("message", true);
      const res = await api.post("/admin/announce", { message, sentBy: interaction.user.tag ?? interaction.user.username });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json() as any;
      await interaction.editReply({ embeds: [successEmbed("Announcement Sent", `Queued for **${d.targetCount ?? "all"}** servers.`)] });
    }
  } catch (err: any) {
    await interaction.editReply({ embeds: [errorEmbed("Error", err.message ?? "An unexpected error occurred.")] });
  }
}
