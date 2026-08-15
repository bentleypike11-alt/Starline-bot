import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from "discord.js";
import { config } from "../../lib/config.js";
import { api } from "../../lib/api.js";
import { premiumEmbed, errorEmbed } from "../../lib/embed.js";

export const data = new SlashCommandBuilder()
  .setName("give-premium")
  .setDescription("[StarLine Support] Grant StarLine Premium to a server")
  .addStringOption(o =>
    o.setName("guild_id").setDescription("The Discord server ID to grant premium to").setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName("days").setDescription("Duration in days (default: 30)").setRequired(false).setMinValue(1).setMaxValue(365)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  // Must be used inside the Zenith support server
  if (config.supportServerId && interaction.guildId !== config.supportServerId) {
    await interaction.reply({
      content: "❌ This command can only be used inside the **StarLine support server**.",
      ephemeral: true,
    });
    return;
  }

  // Caller must hold the Premium Giver role
  if (config.premiumGiverRoleId) {
    const member = interaction.member as GuildMember | null;
    const roles  = member?.roles;
    const hasRole =
      roles && typeof (roles as any).cache?.has === "function"
        ? (roles as any).cache.has(config.premiumGiverRoleId)
        : Array.isArray(roles) && (roles as string[]).includes(config.premiumGiverRoleId);
    if (!hasRole) {
      await interaction.reply({
        content: "❌ You need the **Premium Giver** role to use this command.",
        ephemeral: true,
      });
      return;
    }
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.options.getString("guild_id", true).trim();
  const days    = interaction.options.getInteger("days") ?? 30;

  try {
    const result  = await api.premium.give(guildId, days);
    const expires = new Date(result.expiresAt);
    const ts      = Math.floor(expires.getTime() / 1000);

    await interaction.editReply({
      embeds: [
        premiumEmbed("Premium Granted")
          .setDescription(`Server **\`${guildId}\`** is now on **Zenith Pro** for **${days} day${days !== 1 ? "s" : ""}**.`)
          .addFields(
            { name: "🆔 Server ID",  value: `\`${guildId}\``,                       inline: true },
            { name: "📅 Duration",   value: `${days} day${days !== 1 ? "s" : ""}`,   inline: true },
            { name: "⏰ Expires",    value: `<t:${ts}:F>\n(<t:${ts}:R>)`,            inline: false },
            { name: "👤 Granted by", value: `${interaction.user} (${interaction.user.username})`, inline: true },
          ),
      ],
    });
  } catch (err: any) {
    await interaction.editReply({
      embeds: [errorEmbed("Failed to Grant Premium", err.message || "Unknown error")],
    });
  }
}
