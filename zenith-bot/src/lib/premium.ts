import { ChatInputCommandInteraction } from "discord.js";
import { errorEmbed } from "./embed.js";

export interface PremiumFeature {
  name: string;
  freeLimit?: number;
  premiumLimit?: number | null;
  description: string;
}

export const PREMIUM_FEATURES: Record<string, PremiumFeature> = {
  STAFF_ROSTER: {
    name: "Staff Roster Size",
    freeLimit: 25,
    premiumLimit: null,
    description: "Manage unlimited staff members (Premium: Unlimited)",
  },
  RANKS: {
    name: "Custom Ranks",
    freeLimit: 5,
    premiumLimit: null,
    description: "Create unlimited custom ranks (Premium: Unlimited)",
  },
  DIVISIONS: {
    name: "Divisions",
    freeLimit: 3,
    premiumLimit: null,
    description: "Create unlimited divisions (Premium: Unlimited)",
  },
  STRIKE_AUTOMATION: {
    name: "Strike Automation",
    freeLimit: 0,
    premiumLimit: 1,
    description: "Automatic strike actions (Premium: Enabled)",
  },
  EXTENDED_LOGGING: {
    name: "Extended Logging",
    freeLimit: 7,
    premiumLimit: 90,
    description: "Log retention days (Premium: 90 days)",
  },
  CUSTOM_BRANDING: {
    name: "Custom Branding",
    freeLimit: 0,
    premiumLimit: 1,
    description: "Custom bot name and avatar (Premium: Enabled)",
  },
  APPLICATION_SYSTEM: {
    name: "Application System",
    freeLimit: 0,
    premiumLimit: 1,
    description: "Staff applications (Premium: Enabled)",
  },
};

export async function checkPremium(guildId: string): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.API_URL || "http://localhost:8080/api"}/guilds/${guildId}/premium`, {
      headers: { "X-Bot-Secret": process.env.BOT_SECRET || "" },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.isPremium === true;
  } catch {
    return false;
  }
}

export async function handlePremiumLimit(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  feature: string,
  currentCount: number
): Promise<boolean> {
  const featureInfo = PREMIUM_FEATURES[feature];
  if (!featureInfo) return true;

  const isPremium = await checkPremium(guildId);
  const limit = isPremium ? featureInfo.premiumLimit : featureInfo.freeLimit;

  if (limit != null && currentCount >= limit) {
    const embed = errorEmbed(
      "Premium Feature Limit Reached",
      `You've reached the limit for **${featureInfo.name}**.\n\n` +
      `📊 **Current:** ${currentCount}/${limit}\n` +
      `✨ **Premium:** Unlimited\n\n` +
      `[Upgrade to Premium](https://starline-bot-1.onrender.com//premium) to unlock unlimited access!`
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return false;
  }

  return true;
}

export function getPremiumStatus(guildId: string): Promise<{
  isPremium: boolean;
  expiresAt: Date | null;
}> {
  return fetch(`${process.env.API_URL || "http://localhost:8080/api"}/guilds/${guildId}/premium`, {
    headers: { "X-Bot-Secret": process.env.BOT_SECRET || "" },
  })
    .then(r => r.json())
    .catch(() => ({ isPremium: false, expiresAt: null }));
}
