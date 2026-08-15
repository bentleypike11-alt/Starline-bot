import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { infoEmbed } from "../lib/embed.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all StarLine commands");

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = infoEmbed("Starline — Command Reference")
    .setDescription("The professional ERLC Staff Management System")
    .addFields(
      {
        name: "👥 Staff Management",
        value: [
          "`/staff add` — Add a member to the roster",
          "`/staff remove` — Remove from the roster",
          "`/staff info` — View a member's profile",
          "`/staff list` — List all active staff",
          "`/staff promote` — Update a member's rank",
        ].join("\n"),
      },
      {
        name: "⚠️ Strikes",
        value: [
          "`/strike issue` — Issue a strike",
          "`/strike list` — View active strikes",
          "`/strike revoke` — Revoke a strike by ID",
        ].join("\n"),
      },
      {
        name: "🏖️ Leave of Absence",
        value: [
          "`/loa request` — Submit an LOA request",
          "`/loa list` — View LOA requests",
          "`/loa approve` — Approve a request (admin)",
          "`/loa deny` — Deny a request (admin)",
        ].join("\n"),
      },
      {
        name: "📊 Other",
        value: [
          "`/ranks` — View rank hierarchy",
          "`/activity log` — Log a custom activity",
          "`/activity leaderboard` — View activity leaderboard",
          "`/config` — View current configuration",
          "`/help` — Show this message",
        ].join("\n"),
      },
    )
    .setFooter({ text: "Full dashboard: https://zenith.app | More features with Pro" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
