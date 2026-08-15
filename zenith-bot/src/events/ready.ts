import { Client, Events, ActivityType } from 'discord.js';
import { config } from '../lib/config.js';

export const name = Events.ClientReady;
export const once = true;

/**
 * Fetch the custom global status from the API and apply it to the bot.
 * Falls back to the default status if the API is unavailable.
 */
async function applyCustomStatus(client: Client<true>): Promise<void> {
  try {
    const res = await fetch(`${config.apiUrl}/api/bot/global-status`, {
      headers: {
        'x-bot-secret': config.botSecret,
      },
    });

    if (res.ok) {
      const data: any = await res.json();

      if (data.status && data.status.trim()) {
        client.user.setPresence({
          activities: [
            {
              name: data.status.trim(),
              type: ActivityType.Custom,
            },
          ],
          status: 'online',
        });

        console.log(`[Zenith] Applied custom status: ${data.status}`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Zenith] Failed to fetch custom status:', err);
  }

  // Default presence
  client.user.setPresence({
    activities: [
      {
        name: 'ERLC Staff | z!help',
        type: ActivityType.Watching,
      },
    ],
    status: 'online',
  });
}

export async function execute(client: Client<true>): Promise<void> {
  console.log(`[Zenith] Logged in as ${client.user.tag}`);
  console.log(`[Zenith] Serving ${client.guilds.cache.size} guild(s)`);

  /*
   * ─────────────────────────────────────────────────────────────
   * Slash Command Registration
   * ─────────────────────────────────────────────────────────────
   */

  try {
    const commandCollection = (client as any).commands;

    const allCommands = commandCollection
      ? [...commandCollection.values()]
      : [];

    const supportCommandNames = new Set([
      'support',
      'give-premium',
    ]);

    /*
     * Global commands:
     * Everything EXCEPT support-only commands.
     */
    const globalCommands = allCommands
      .filter(
        (cmd: any) =>
          cmd?.data &&
          !supportCommandNames.has(cmd.data.name)
      )
      .map((cmd: any) => cmd.data.toJSON());

    /*
     * Support-server-only commands.
     */
    const supportCommands = allCommands
      .filter(
        (cmd: any) =>
          cmd?.data &&
          supportCommandNames.has(cmd.data.name)
      )
      .map((cmd: any) => cmd.data.toJSON());

    /*
     * Register normal commands globally.
     */
    await client.application?.commands.set(globalCommands);

    console.log(
      `[Zenith] Registered ${globalCommands.length} global slash command(s)`
    );

    /*
     * Support server:
     *
     * Global commands automatically appear there.
     * We only need to add the support-only commands.
     */
    if (config.supportServerId) {
      const supportGuild = client.guilds.cache.get(
        config.supportServerId
      );

      if (supportGuild) {
        await supportGuild.commands.set([
          ...globalCommands,
          ...supportCommands,
        ]);

        console.log(
          `[Zenith] Registered ${supportCommands.length} support-only command(s) to ${supportGuild.name}`
        );
      } else {
        console.warn(
          `[Zenith] Support server ${config.supportServerId} was not found.`
        );
      }
    }

    /*
     * Remove old guild-specific commands from every
     * non-support server.
     */
    for (const guild of client.guilds.cache.values()) {
      if (guild.id === config.supportServerId) {
        continue;
      }

      try {
        await guild.commands.set([]);
      } catch (err) {
        console.warn(
          `[Zenith] Failed to clear commands from ${guild.name}:`,
          err
        );
      }
    }

    console.log(
      '[Zenith] Slash command registration complete.'
    );
  } catch (err) {
    console.error(
      '[Zenith] Failed to register commands:',
      err
    );
  }

  /*
   * ─────────────────────────────────────────────────────────────
   * Register Guild Data With API
   * ─────────────────────────────────────────────────────────────
   */

  for (const guild of client.guilds.cache.values()) {
    fetch(`${config.apiUrl}/guilds/${guild.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Secret': config.botSecret,
      },
      body: JSON.stringify({
        name: guild.name,
        icon: guild.icon,
      }),
    }).catch(() => {});
  }

  /*
   * ─────────────────────────────────────────────────────────────
   * Bot Presence
   * ─────────────────────────────────────────────────────────────
   */

  await applyCustomStatus(client);

  /*
   * Refresh the custom status every 5 minutes.
   */
  setInterval(
    () => {
      void applyCustomStatus(client);
    },
    5 * 60 * 1000
  );
}
