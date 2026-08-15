import { Client, Events, ActivityType } from 'discord.js';
import { config } from '../lib/config.js';

export const name = Events.ClientReady;
export const once = true;

/**
 * Fetch the custom global status from the API and apply it to the bot.
 * Falls back to the default status if the API is unavailable.
 */
async function applyCustomStatus(client: Client<true>): Promise<void> {
  const defaultStatus = {
    activities: [
      {
        name: 'ERLC Staff | z!help',
        type: ActivityType.Watching,
      },
    ],
    status: 'online' as const,
  };

  try {
    const apiUrl = `${config.apiUrl.replace(/\/+$/, '')}/api/bot/global-status`;

    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-bot-secret': config.botSecret,
      },
    });

    if (!res.ok) {
      console.warn(
        `[Zenith] Custom status API returned HTTP ${res.status} ${res.statusText}`
      );

      client.user.setPresence(defaultStatus);
      return;
    }

    const contentType = res.headers.get('content-type') || '';

    if (!contentType.toLowerCase().includes('application/json')) {
      console.warn(
        `[Zenith] Custom status API returned non-JSON response: ${contentType || 'unknown'}`
      );

      client.user.setPresence(defaultStatus);
      return;
    }

    const data: unknown = await res.json();

    const status =
      typeof data === 'object' &&
      data !== null &&
      'status' in data &&
      typeof (data as { status?: unknown }).status === 'string'
        ? (data as { status: string }).status.trim()
        : '';

    if (status) {
      client.user.setPresence({
        activities: [
          {
            name: status,
            type: ActivityType.Custom,
          },
        ],
        status: 'online',
      });

      console.log(`[Zenith] Applied custom status: ${status}`);
      return;
    }

    console.log(
      '[Zenith] No custom status configured. Using default status.'
    );

    client.user.setPresence(defaultStatus);
  } catch (err) {
    console.warn(
      '[Zenith] Failed to fetch custom status:',
      err instanceof Error ? err.message : err
    );

    client.user.setPresence(defaultStatus);
  }
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
     * Global commands + support-only commands.
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
   * Refresh custom status every 5 minutes.
   */
  setInterval(() => {
    void applyCustomStatus(client);
  }, 5 * 60 * 1000);
}
