import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { config } from "../lib/config.js";

export const data = new SlashCommandBuilder()
  .setName("premium")
  .setDescription("View StarLine Premium features and your server's subscription status");

const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://starline-bot-1.onrender.com/";

const FREE_FEATURES = [
  "👥 Up to 25 staff members",
  "🏅 Up to 5 custom ranks",
  "⚠️ Strike & warning system",
  "📋 Applications with 13 questions",
  "🏢 Up to 5 divisions",
  "⚡ Up to 5 custom commands",
  "📖 Staff handbook (public entries)",
  "🕐 Shift tracking & duty roster",
  "📊 Activity logs (7-day retention)",
  "🏆 Commendations & notes",
  "📝 LOA requests",
  "🎓 Training programs",
];

const PREMIUM_FEATURES = [
  "👥 **Unlimited** staff members",
  "🏅 **Unlimited** custom ranks",
  "⚡ Strike automation (auto-demote/kick on threshold)",
  "📨 Mass DM all staff at once",
  "🏢 Up to **50 divisions**",
  "💬 **Unlimited** custom commands",
  "🎴 Auto shift cards — configure & send automatically",
  "📊 90-day activity log retention",
  "📖 Handbook role visibility (control who sees what)",
  "🎨 Custom bot embed branding",
  "📋 Unlimited application panels & questions",
  "🔔 Auto-inactivity DMs & alerts",
  "📈 Advanced analytics & reporting",
  "⭐ Priority support",
];

export async function execute(interaction: ChatInputCommandInteraction) {
  // This is a global command — works in DMs and servers
  const guildId = interaction.guildId;

  await interaction.deferReply({ ephemeral: false });

  let isPremium = false;
  let expiresAt: Date | null = null;
  let plan = "free";
  let daysLeft: number | null = null;

  if (guildId) {
    try {
      const res = await fetch(`${config.apiUrl}/guilds/${guildId}/premium`, {
        headers: { "x-bot-secret": config.botSecret },
      });
      if (res.ok) {
        const data = (await res.json()) as { isPremium?: boolean; expiresAt?: string; plan?: string };
        isPremium = data.isPremium ?? false;
        expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        plan = data.plan ?? "free";
        if (expiresAt) {
          daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
        }
      }
    } catch {}
  }

  if (isPremium) {
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle("⭐ StarLine Premium — Active")
      .setDescription(
        `This server is running **Zenith Premium**!\n\n` +
        `**Your Premium Unlocks:**\n${PREMIUM_FEATURES.join("\n")}`
      )
      .addFields(
        { name: "📦 Plan", value: plan === "premium" ? "StarLine Premium" : plan.charAt(0).toUpperCase() + plan.slice(1), inline: true },
        { name: "✅ Status", value: "Active", inline: true },
        {
          name: "📅 Expires",
          value: expiresAt
            ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:D>${daysLeft !== null ? ` (${daysLeft} day${daysLeft !== 1 ? "s" : ""} left)` : ""}`
            : "Lifetime / No expiry",
          inline: true,
        }
      )
      .setFooter({ text: "StarLine Staff Management • Dashboard: " + DASHBOARD_URL })
      .setTimestamp();

    if (daysLeft !== null && daysLeft <= 7) {
      embed.addFields({
        name: "⚠️ Renew Soon",
        value: `Premium expires in **${daysLeft} day${daysLeft !== 1 ? "s" : ""}**. Contact an admin to renew before your features are limited.`,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // Not premium — sell them on it
  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle("💎 Unlock StarLine Premium")
    .setDescription(
      `**Why upgrade?**\n\n` +
      `Zenith Premium gives your server the full staff management suite — from unlimited staff & ranks to automatic strike actions, mass DMs, advanced analytics, and more.\n\n` +
      `**Free Plan (Current):**\n${FREE_FEATURES.join("\n")}\n\n` +
      `**Premium Unlocks:**\n${PREMIUM_FEATURES.join("\n")}`
    )
    .addFields({
      name: "🚀 Get Premium",
      value: `Visit our premium page to upgrade:\n${DASHBOARD_URL}/premium`,
    })
    .setFooter({ text: "Zenith Staff Management • The #1 ERLC staff management bot" })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
