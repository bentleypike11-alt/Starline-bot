import "dotenv/config";

function normalizeApiUrl(raw: string): string {
  if (!raw) return "http://localhost:8000/api";
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = `https://${raw}`;
  }
  raw = raw.replace(/\/+$/, "");
  if (!raw.endsWith("/api")) raw = `${raw}/api`;
  return raw;
}

export const config = {
  token:              process.env.DISCORD_BOT_TOKEN ?? "",
  clientId:           process.env.DISCORD_CLIENT_ID ?? "",
  apiUrl:             normalizeApiUrl(process.env.API_URL ?? "http://localhost:8080/api"),
  botSecret:          process.env.BOT_SECRET ?? "g7SwyS-wFmqln4otSHdgBs2NQsm3fKbz",
  supportServerId:    process.env.SUPPORT_SERVER_ID ?? "1515508593460379771",
  premiumGiverRoleId: process.env.PREMIUM_GIVER_ROLE_ID ?? "",
};

// Also export as default for commands that import the whole module
export default config;

if (!config.token)    throw new Error("DISCORD_BOT_TOKEN is required");
if (!config.clientId) throw new Error("DISCORD_CLIENT_ID is required");
