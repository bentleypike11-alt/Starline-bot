import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb, upsertUser, query, pool } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const DISCORD_API = 'https://discord.com/api/v10';
const AUDIT_ACTION_MAP = {
  1: 'GUILD_UPDATE', 10: 'CHANNEL_CREATE', 11: 'CHANNEL_UPDATE', 12: 'CHANNEL_DELETE',
  20: 'MEMBER_KICK', 21: 'MEMBER_PRUNE', 22: 'MEMBER_BAN_ADD', 23: 'MEMBER_BAN_REMOVE',
  24: 'MEMBER_UPDATE', 25: 'MEMBER_ROLE_UPDATE', 28: 'BOT_ADD',
  30: 'ROLE_CREATE', 31: 'ROLE_UPDATE', 32: 'ROLE_DELETE',
  72: 'MESSAGE_DELETE', 73: 'MESSAGE_BULK_DELETE',
  80: 'INTEGRATION_CREATE', 81: 'INTEGRATION_UPDATE', 82: 'INTEGRATION_DELETE',
};

// ── 1. Health Checks — must respond instantly ─────────────────────────────
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/healthz', (_req, res) => res.status(200).send('OK'));
app.get('/ping', (_req, res) => res.status(200).send('pong'));
app.get('/version', (_req, res) => res.json({ version: '2.0.0', status: 'online' }));

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  DISCORD_BOT_TOKEN,
  SESSION_SECRET = 'zenith-secret-key-123',
  DATABASE_URL,
  BOT_SECRET,
} = process.env;
// Use DISCORD_CLIENT_ID as application ID for custom command registration
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID || DISCORD_CLIENT_ID;

const DISCORD_BOT_INVITE = `https://discord.com/oauth2/authorize?client_id=1517577280434475141&permissions=8&integration_type=0&scope=bot`;
const SUPPORT_SERVER_ID   = process.env.SUPPORT_SERVER_ID || '1501905192277377214';
const SUPPORT_SERVER_INVITE = 'https://discord.gg/Gv2zmPteJ7';
const PREMIUM_ROLE_ID     = process.env.PREMIUM_ROLE_ID || '1505732884168704050';
const INTERACTIONS_PUBLIC_KEY = process.env.INTERACTIONS_PUBLIC_KEY || '';

// ── 2. Middleware ─────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const PgSession = connectPgSimple(session);
const sessionStore = DATABASE_URL
  ? new PgSession({ pool, tableName: 'session', createTableIfMissing: true })
  : undefined;

app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── 3. DB Init ──────────────────────────────────────────────────────────
if (DATABASE_URL) initDb().catch(err => console.error('[DB] Init error:', err));

// ── 4. Auth Helpers ──────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  // Bot auth: accept if X-Bot-Secret header is present AND
  //   (a) BOT_SECRET is not configured on this server (open-mode), OR
  //   (b) it matches the configured BOT_SECRET
  const incoming = (req.headers['x-bot-secret'] || '').trim();
  if (incoming) {
    if (!BOT_SECRET || incoming === BOT_SECRET.trim()) return next();
  }
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireBotSecret(req, res, next) {
  // Require X-Bot-Secret header to be present
  const incoming = (req.headers['x-bot-secret'] || '').trim();
  if (!incoming) return res.status(403).json({ error: 'Forbidden' });
  // If BOT_SECRET is configured, verify it matches; if not set, allow any header value
  if (BOT_SECRET && incoming !== BOT_SECRET.trim()) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Accepts either valid session OR valid bot-secret header
function requireBotOrAuth(req, res, next) {
  const incoming = (req.headers['x-bot-secret'] || '').trim();
  if (incoming && (!BOT_SECRET || incoming === BOT_SECRET.trim())) return next();
  return requireAuth(req, res, next);
}

// ── 5. Discord Auth ──────────────────────────────────────────────────────
async function handleAuthCallback(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');
  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return res.redirect('/?error=token_failed');

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    const userData = {
      id: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar,
      avatarUrl: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      accessToken: tokens.access_token,
    };

    req.session.discordAccessToken = tokens.access_token;
    req.session.user = userData;

    req.session.save((err) => {
      if (err) console.error('[Auth] Session save error:', err);
      if (DATABASE_URL) upsertUser(userData).catch(() => {});
      res.redirect('/servers');
    });
  } catch (err) {
    console.error('[auth] Callback error:', err);
    res.redirect('/?error=auth_failed');
  }
}

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});
app.get('/api/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});
app.get('/auth/callback', handleAuthCallback);
app.get('/api/auth/discord/callback', handleAuthCallback);
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── 6. User Routes ───────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const { accessToken, ...safe } = req.session.user;
  res.json(safe);
});
app.get('/api/user', requireAuth, (req, res) => {
  const { accessToken, ...safe } = req.session.user;
  res.json(safe);
});
app.get('/api/auth/user', requireAuth, (req, res) => {
  const { accessToken, ...safe } = req.session.user;
  res.json(safe);
});
app.get('/api/auth/me', requireAuth, (req, res) => {
  const { accessToken, ...safe } = req.session.user;
  res.json(safe);
});

// ── 7. Guild List ────────────────────────────────────────────────────────
async function getManageableGuilds(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const guilds = await res.json();
  if (!Array.isArray(guilds)) return [];
  const ADMIN = BigInt(0x8), MANAGE = BigInt(0x20);
  return guilds.filter(g => {
    const p = BigInt(g.permissions);
    return g.owner || (p & ADMIN) === ADMIN || (p & MANAGE) === MANAGE;
  });
}

app.get('/api/guilds', requireAuth, async (req, res) => {
    try {
      const guilds = await getManageableGuilds(req.session.user.accessToken);
      const guildList = guilds.map(g => ({
        id: g.id, name: g.name, icon: g.icon,
        iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        botInstalled: false,
      }));

      if (DISCORD_BOT_TOKEN) {
        await Promise.all(guildList.map(async (guild) => {
          try {
            const r = await fetch(`${DISCORD_API}/guilds/${guild.id}`, {
              headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
            });
            guild.botInstalled = r.ok;
          } catch {}
        }));
      }

      res.json(guildList);
    } catch (err) {
      console.error('[guilds]', err);
      res.status(500).json({ error: 'Failed to fetch guilds' });
    }
  });

app.get('/api/auth/guilds', requireAuth, async (req, res) => {
  try {
    const guilds = await getManageableGuilds(req.session.user.accessToken);
    const guildList = guilds.map(g => ({
      id: g.id, name: g.name, icon: g.icon,
      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
      owner: g.owner, role: g.owner ? 'Owner' : 'Admin',
      botAdded: false,
    }));

    if (DISCORD_BOT_TOKEN) {
      await Promise.all(guildList.map(async (guild) => {
        try {
          const r = await fetch(`${DISCORD_API}/guilds/${guild.id}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
          });
          guild.botAdded = r.ok;
        } catch {}
      }));
    }

    res.json(guildList);
  } catch (err) {
    console.error('[auth/guilds]', err);
    res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

// ── 8. Guild Discord Data (channels, roles) ───────────────────────────────
// GET /api/guilds/:id — fetch single guild (used by dashboard layout)
  app.get('/api/guilds/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
      // First try DB (skip placeholder rows where name was set to the ID itself)
      if (DATABASE_URL) {
        const dbRes = await query('SELECT * FROM servers WHERE id = $1', [id]);
        if (dbRes.rows.length > 0 && dbRes.rows[0].name !== id) {
          const row = dbRes.rows[0];
          const icon = row.icon || row.icon_url;
          return res.json({
            id: row.id,
            name: row.name,
            icon: icon,
            iconUrl: icon ? `https://cdn.discordapp.com/icons/${row.id}/${icon}.webp?size=128` : null,
            isPremium: !!row.is_premium,
            premiumExpiresAt: row.premium_expires_at,
          });
        }
      }
      // Fall back to Discord API via bot token
      if (DISCORD_BOT_TOKEN) {
        const r = await fetch(`${DISCORD_API}/guilds/${id}`, {
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
        });
        if (r.ok) {
          const g = await r.json();
          // Upsert real name/icon so future DB reads are correct
          if (DATABASE_URL) {
            await query(
              `INSERT INTO servers (id, name, icon) VALUES ($1, $2, $3)
               ON CONFLICT (id) DO UPDATE SET name = $2, icon = $3, updated_at = NOW()`,
              [g.id, g.name, g.icon || null]
            ).catch(() => {});
          }
          return res.json({
            id: g.id,
            name: g.name,
            icon: g.icon,
            iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=128` : null,
            memberCount: g.approximate_member_count,
            isPremium: false,
          });
        }
      }
      res.status(404).json({ error: 'Guild not found' });
    } catch (err) {
      console.error('[guild get]', err);
      res.status(500).json({ error: 'Failed to fetch guild' });
    }
  });

  app.get('/api/guilds/:id/channels', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DISCORD_BOT_TOKEN) return res.status(400).json({ error: 'Bot token not configured' });
  try {
    const r = await fetch(`${DISCORD_API}/guilds/${id}/channels`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Discord API error' });
    const channels = await r.json();
    // Return all text channels and categories
    res.json(channels
      .filter(c => c.type === 0 || c.type === 5 || c.type === 15)
      .sort((a, b) => a.position - b.position)
      .map(c => ({ id: c.id, name: c.name, type: c.type })));
  } catch (err) {
    console.error('[channels]', err);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

app.get('/api/guilds/:id/roles', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DISCORD_BOT_TOKEN) return res.status(400).json({ error: 'Bot token not configured' });
  try {
    const r = await fetch(`${DISCORD_API}/guilds/${id}/roles`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Discord API error' });
    const roles = await r.json();
    res.json(roles
      .filter(r => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#99aab5' })));
  } catch (err) {
    console.error('[roles]', err);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

app.get('/api/guilds/:id/roles-list', requireAuth, async (req, res) => {
  req.params.id = req.params.id;
  // Alias to above
  if (!DISCORD_BOT_TOKEN) return res.json([]);
  try {
    const r = await fetch(`${DISCORD_API}/guilds/${req.params.id}/roles`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    const roles = r.ok ? await r.json() : [];
    res.json(roles.filter(r => r.name !== '@everyone').sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.color })));
  } catch { res.json([]); }
});

app.get('/api/guilds/:id/members', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DISCORD_BOT_TOKEN) return res.json([]);
  try {
    const r = await fetch(`${DISCORD_API}/guilds/${id}/members?limit=1000`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    const members = r.ok ? await r.json() : [];
    res.json(members.map(m => ({
      id: m.user.id,
      username: m.user.global_name || m.user.username,
      avatar: m.user.avatar
        ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      roles: m.roles,
      nick: m.nick,
    })));
  } catch (err) {
    console.error('[members]', err);
    res.json([]);
  }
});

app.get('/api/guilds/:id/detailed', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    let guildData = null;
    if (DISCORD_BOT_TOKEN) {
      const r = await fetch(`${DISCORD_API}/guilds/${id}?with_counts=true`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });
      if (r.ok) guildData = await r.json();
    }

    let channels = [], roles = [];
    if (DISCORD_BOT_TOKEN) {
      const [cR, rR] = await Promise.all([
        fetch(`${DISCORD_API}/guilds/${id}/channels`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }),
        fetch(`${DISCORD_API}/guilds/${id}/roles`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }),
      ]);
      if (cR.ok) channels = await cR.json();
      if (rR.ok) roles = await rR.json();
    }

    res.json({
      name: guildData?.name || 'Unknown',
      icon: guildData?.icon,
      iconUrl: guildData?.icon ? `https://cdn.discordapp.com/icons/${id}/${guildData.icon}.png` : null,
      member_count: guildData?.approximate_member_count || 0,
      online_count: guildData?.approximate_presence_count || 0,
      channels: channels.length,
      roles: roles.length,
      emojis: guildData?.emojis?.length || 0,
    });
  } catch (err) {
    console.error('[detailed]', err);
    res.status(500).json({ error: 'Failed to fetch guild details' });
  }
});

// ── 9. Guild Registration (bot callable) ─────────────────────────────────
app.put('/api/guilds/:id', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  const { name, icon } = req.body;
  if (!DATABASE_URL) return res.json({ ok: true });
  try {
    await query(
      `INSERT INTO servers (id, name, icon, icon_url, bot_added, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (id) DO UPDATE SET name = $2, icon = $3, icon_url = $4, bot_added = TRUE, updated_at = NOW()`,
      [id, name, icon, icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png` : null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[guild upsert]', err);
    res.status(500).json({ error: 'Failed to upsert guild' });
  }
});

// ── 10. Premium ─────────────────────────────────────────────────────────
app.get('/api/guilds/:id/premium', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ isPremium: false });
  try {
    const r = await query(`SELECT is_premium, premium_expires_at FROM servers WHERE id = $1`, [id]);
    const row = r.rows[0];
    const expired = row?.premium_expires_at && new Date(row.premium_expires_at) < new Date();
    res.json({ isPremium: !!row?.is_premium && !expired, expiresAt: row?.premium_expires_at || null });
  } catch { res.json({ isPremium: false }); }
});

app.get('/api/guilds/:id/is-premium', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ premium: false, isPremium: false });
  try {
    const r = await query(`SELECT is_premium, premium_expires_at FROM servers WHERE id = $1`, [id]);
    const row = r.rows[0];
    const expired = row?.premium_expires_at && new Date(row.premium_expires_at) < new Date();
    const ok = !!row?.is_premium && !expired;
    res.json({ premium: ok, isPremium: ok });
  } catch { res.json({ premium: false, isPremium: false }); }
});

// Admin: give premium (bot or admin only)
app.post('/api/admin/give-premium', requireBotSecret, async (req, res) => {
  const { guildId, days } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No DB' });
  try {
    const expires = new Date(Date.now() + (days || 30) * 86400000);
    await query(
      `INSERT INTO servers (id, name, is_premium, premium_expires_at)
       VALUES ($1, $1, TRUE, $2)
       ON CONFLICT (id) DO UPDATE SET is_premium = TRUE, premium_expires_at = $2`,
      [guildId, expires]
    );
    res.json({ ok: true, expiresAt: expires });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/revoke-premium', requireBotSecret, async (req, res) => {
  const { guildId } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No DB' });
  try {
    await query(`UPDATE servers SET is_premium = FALSE WHERE id = $1`, [guildId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 11. Server Config ────────────────────────────────────────────────────
app.get('/api/guilds/:id/config', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({});
  try {
    const r = await query(`SELECT * FROM server_config WHERE guild_id = $1`, [id]);
    res.json(r.rows[0] || {});
  } catch (err) {
    console.error('[config get]', err);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

app.put('/api/guilds/:id/config', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database configured' });

  const {
    logs_channel_id, loa_channel_id, applications_channel_id,
    applications_review_channel_id, welcome_channel_id, strike_log_channel_id,
    promotion_log_channel_id, commendation_channel_id, shift_cards_channel_id,
    staff_role_id, admin_role_id, management_role_id, on_loa_role_id,
    rank_request_reviewer_role_id,
    embed_color, embed_footer,
    strike_threshold, strike_action, strike_automation,
    strike_dm_user, strike_log_enabled,
    loa_max_days, loa_require_approval,
    applications_enabled, applications_title, applications_questions,
    require_recommendations, auto_reject,
    prefix, timezone, activity_tracking, shift_tracking_enabled,
    staff_role_ids, admin_role_ids, management_role_ids,
    log_strikes, log_promotions, log_loa, log_commendations,
    log_applications, log_staff_changes, log_shifts,
  } = req.body;

  try {
    const r = await query(
      `INSERT INTO server_config (
        guild_id,
        logs_channel_id, loa_channel_id, applications_channel_id,
        applications_review_channel_id, welcome_channel_id, strike_log_channel_id,
        promotion_log_channel_id, commendation_channel_id, shift_cards_channel_id,
        staff_role_id, admin_role_id, management_role_id, on_loa_role_id,
        rank_request_reviewer_role_id,
        embed_color, embed_footer,
        strike_threshold, strike_action, strike_automation,
        strike_dm_user, strike_log_enabled,
        loa_max_days, loa_require_approval,
        applications_enabled, applications_title, applications_questions,
        require_recommendations, auto_reject,
        prefix, timezone, activity_tracking, shift_tracking_enabled,
        staff_role_ids, admin_role_ids, management_role_ids,
        log_strikes, log_promotions, log_loa, log_commendations,
        log_applications, log_staff_changes, log_shifts,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27::jsonb,$28,$29,$30,$31,$32,$33,$34,$35,$36,
        $37,$38,$39,$40,$41,$42,$43,NOW()
      )
      ON CONFLICT (guild_id) DO UPDATE SET
        logs_channel_id = $2, loa_channel_id = $3, applications_channel_id = $4,
        applications_review_channel_id = $5, welcome_channel_id = $6, strike_log_channel_id = $7,
        promotion_log_channel_id = $8, commendation_channel_id = $9, shift_cards_channel_id = $10,
        staff_role_id = $11, admin_role_id = $12, management_role_id = $13, on_loa_role_id = $14,
        rank_request_reviewer_role_id = $15,
        embed_color = $16, embed_footer = $17,
        strike_threshold = $18, strike_action = $19, strike_automation = $20,
        strike_dm_user = $21, strike_log_enabled = $22,
        loa_max_days = $23, loa_require_approval = $24,
        applications_enabled = $25, applications_title = $26, applications_questions = $27::jsonb,
        require_recommendations = $28, auto_reject = $29,
        prefix = $30, timezone = $31, activity_tracking = $32, shift_tracking_enabled = $33,
        staff_role_ids = $34, admin_role_ids = $35, management_role_ids = $36,
        log_strikes = $37, log_promotions = $38, log_loa = $39, log_commendations = $40,
        log_applications = $41, log_staff_changes = $42, log_shifts = $43,
        updated_at = NOW()
      RETURNING *`,
      [
        id,
        logs_channel_id || null, loa_channel_id || null, applications_channel_id || null,
        applications_review_channel_id || null, welcome_channel_id || null, strike_log_channel_id || null,
        promotion_log_channel_id || null, commendation_channel_id || null, shift_cards_channel_id || null,
        staff_role_id || null, admin_role_id || null, management_role_id || null, on_loa_role_id || null,
        rank_request_reviewer_role_id || null,
        embed_color || '#d4af37', embed_footer || 'Zenith Staff Management',
        strike_threshold ?? 3, strike_action || 'demotion', !!strike_automation,
        strike_dm_user !== false, strike_log_enabled !== false,
        loa_max_days ?? 14, loa_require_approval !== false,
        !!applications_enabled, applications_title || null,
        JSON.stringify(applications_questions || []),
        !!require_recommendations, !!auto_reject,
        prefix || '!', timezone || 'UTC', activity_tracking !== false, shift_tracking_enabled !== false,
        Array.isArray(staff_role_ids) ? staff_role_ids : [],
        Array.isArray(admin_role_ids) ? admin_role_ids : [],
        Array.isArray(management_role_ids) ? management_role_ids : [],
        log_strikes !== false, log_promotions !== false, log_loa !== false, log_commendations !== false,
        log_applications !== false, log_staff_changes !== false, log_shifts !== false,
      ]
    );

    // Also ensure server record exists
    await query(
      `INSERT INTO servers (id, name) VALUES ($1, $1)
       ON CONFLICT (id) DO NOTHING`,
      [id]
    ).catch(() => {});

    await logActivity(id, null, null, 'config_update', { updated_by: req.session?.user?.id });
    res.json({ success: true, config: r.rows[0] });
  } catch (err) {
    console.error('[config save]', err);
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

// Keep POST as alias
app.post('/api/guilds/:id/config', requireAuth, async (req, res) => {
  req.method = 'PUT';
  // Re-route logic
  const { id } = req.params;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database configured' });
  const body = req.body;
  try {
    const r = await query(
      `INSERT INTO server_config (guild_id, loa_channel_id, applications_channel_id, logs_channel_id, staff_role_id, admin_role_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id) DO UPDATE SET
         loa_channel_id = COALESCE($2, server_config.loa_channel_id),
         applications_channel_id = COALESCE($3, server_config.applications_channel_id),
         logs_channel_id = COALESCE($4, server_config.logs_channel_id),
         staff_role_id = COALESCE($5, server_config.staff_role_id),
         admin_role_id = COALESCE($6, server_config.admin_role_id),
         updated_at = NOW()
       RETURNING *`,
      [id, body.loaChannelId || null, body.applicationsChannelId || null,
       body.logsChannelId || null, body.staffRoleId || null, body.adminRoleId || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[config post]', err);
    res.status(500).json({ error: 'Failed to save config' });
  }
});



  // ── 11b. Post Panel to Discord ────────────────────────────────────────────
  app.post('/api/guilds/:id/config/post-panel', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { type } = req.body; // 'applications' | 'loa'
    if (!DISCORD_BOT_TOKEN) return res.status(400).json({ error: 'Bot token not configured' });
    if (!DATABASE_URL) return res.status(400).json({ error: 'Database not configured' });
    try {
      const cfgRes = await query('SELECT * FROM server_config WHERE guild_id = $1', [id]);
      const cfg = cfgRes.rows[0];
      if (!cfg) return res.status(400).json({ error: 'No configuration saved yet. Save your config first.' });

      let channelId, embed, components;

      if (type === 'applications') {
        channelId = cfg.applications_channel_id;
        if (!channelId) return res.status(400).json({ error: 'Applications channel not configured.' });
        embed = {
          title: cfg.applications_title || 'Staff Application',
          description: '**Want to join the team?**\n\nClick the button below to submit a staff application. Our management team will review your application and get back to you.',
          color: 0xd4af37,
          footer: { text: cfg.embed_footer || 'Zenith Staff Management' },
          timestamp: new Date().toISOString(),
        };
        components = [{
          type: 1,
          components: [{
            type: 2, style: 1, label: 'Apply Now',
            custom_id: 'zenith_apply',
            emoji: { name: '📋' },
          }],
        }];
      } else if (type === 'loa') {
        channelId = cfg.loa_channel_id;
        if (!channelId) return res.status(400).json({ error: 'LOA channel not configured.' });
        embed = {
          title: 'Leave of Absence Request',
          description: '**Need to take a break?**\n\nClick the button below to submit a Leave of Absence request. Please include your start date, end date, and reason.',
          color: 0xd4af37,
          footer: { text: cfg.embed_footer || 'Zenith Staff Management' },
          timestamp: new Date().toISOString(),
        };
        components = [{
          type: 1,
          components: [{
            type: 2, style: 1, label: 'Request LOA',
            custom_id: 'zenith_loa',
            emoji: { name: '📅' },
          }],
        }];
      } else {
        return res.status(400).json({ error: 'Invalid panel type. Use "applications" or "loa".' });
      }

      const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed], components }),
      });

      if (!msgRes.ok) {
        const err = await msgRes.json();
        const msg = err?.message || 'Discord API error';
        if (msg.includes('Missing Access')) return res.status(400).json({ error: 'Bot does not have access to that channel. Check channel permissions.' });
        return res.status(400).json({ error: `Discord error: ${msg}` });
      }

      await logActivity(id, null, null, 'panel_posted', { type, channel_id: channelId, posted_by: req.session?.user?.id });
      res.json({ success: true, message: `${type === 'applications' ? 'Application' : 'LOA'} panel posted to <#${channelId}>!` });
    } catch (err) {
      console.error('[post-panel]', err);
      res.status(500).json({ error: 'Failed to post panel: ' + err.message });
    }
  });
  
// ── 12. Staff CRUD ───────────────────────────────────────────────────────
app.get('/api/guilds/:id/staff', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT * FROM staff_members WHERE guild_id = $1 AND is_active = TRUE ORDER BY joined_at DESC`,
      [id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[staff list]', err);
    res.json([]);
  }
});

app.post('/api/guilds/:id/staff', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, rank, division, callsign, notes, avatarUrl } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const r = await query(
      `INSERT INTO staff_members (guild_id, user_id, username, role, rank, division, callsign, notes, avatar_url)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         username = EXCLUDED.username, role = EXCLUDED.role, rank = EXCLUDED.rank,
         division = EXCLUDED.division, callsign = EXCLUDED.callsign,
         notes = EXCLUDED.notes, avatar_url = EXCLUDED.avatar_url,
         is_active = TRUE, updated_at = NOW()
       RETURNING *`,
      [id, userId, username, rank || null, division || null, callsign || null, notes || null, avatarUrl || null]
    );
    await logActivity(id, userId, username, 'staff_add', { rank, division });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[staff add]', err);
    res.status(500).json({ error: 'Failed to add staff member', details: err.message });
  }
});

app.get('/api/guilds/:id/staff/:userId', requireAuth, async (req, res) => {
  const { id, userId } = req.params;
  if (!DATABASE_URL) return res.status(404).json({ error: 'Not found' });
  try {
    const [staffR, strikesR, loaR] = await Promise.all([
      query(`SELECT * FROM staff_members WHERE guild_id = $1 AND user_id = $2`, [id, userId]),
      query(`SELECT * FROM strikes WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [id, userId]),
      query(`SELECT * FROM loa_requests WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [id, userId]),
    ]);
    if (!staffR.rows[0]) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ ...staffR.rows[0], strikes: strikesR.rows, loaHistory: loaR.rows });
  } catch (err) {
    console.error('[staff get]', err);
    res.status(500).json({ error: 'Failed to fetch staff member' });
  }
});

app.patch('/api/guilds/:id/staff/:userId', requireAuth, async (req, res) => {
  const { id, userId } = req.params;
  const { rank, division, callsign, notes, robloxUsername } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const r = await query(
      `UPDATE staff_members SET
         rank = COALESCE($3, rank), role = COALESCE($3, role),
         division = COALESCE($4, division), callsign = COALESCE($5, callsign),
         notes = COALESCE($6, notes), roblox_username = COALESCE($7, roblox_username),
         updated_at = NOW()
       WHERE guild_id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, rank || null, division || null, callsign || null, notes || null, robloxUsername || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[staff update]', err);
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

app.delete('/api/guilds/:id/staff/:userId', requireAuth, async (req, res) => {
  const { id, userId } = req.params;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    await query(
      `UPDATE staff_members SET is_active = FALSE, updated_at = NOW() WHERE guild_id = $1 AND user_id = $2`,
      [id, userId]
    );
    await logActivity(id, userId, null, 'staff_remove', {});
    res.json({ success: true });
  } catch (err) {
    console.error('[staff remove]', err);
    res.status(500).json({ error: 'Failed to remove staff member' });
  }
});

// Bot-accessible staff roster (used by z!roster, /roster)
app.get('/api/guilds/:id/staff/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT user_id, username, rank, division, callsign, roblox_username, avatar_url, joined_at, last_active
       FROM staff_members WHERE guild_id=$1 AND is_active=TRUE ORDER BY rank ASC, username ASC`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

// Bot-accessible staff info by userId (used by z!staffinfo, /staffinfo)
app.get('/api/guilds/:id/staff/bot/:userId', requireBotSecret, async (req, res) => {
  const { id, userId } = req.params;
  if (!DATABASE_URL) return res.status(404).json({ error: 'Not found' });
  try {
    const [staffR, strikesR, loaR] = await Promise.all([
      query(`SELECT * FROM staff_members WHERE guild_id=$1 AND user_id=$2 AND is_active=TRUE`, [id, userId]),
      query(`SELECT * FROM strikes WHERE guild_id=$1 AND user_id=$2 AND active=TRUE ORDER BY created_at DESC`, [id, userId]),
      query(`SELECT * FROM loa_requests WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 3`, [id, userId]),
    ]);
    if (!staffR.rows[0]) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ ...staffR.rows[0], strikes: strikesR.rows, loaHistory: loaR.rows });
  } catch { res.status(500).json({ error: 'Failed to fetch staff member' }); }
});

// Bot-accessible strikes lookup (used by z!strikes, z!mystrikes)
app.get('/api/guilds/:id/strikes/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = userId
      ? await query(`SELECT * FROM strikes WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC`, [id, userId])
      : await query(`SELECT * FROM strikes WHERE guild_id=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 100`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

// Bot-accessible warnings lookup (used by z!warnings)
app.get('/api/guilds/:id/warnings/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = userId
      ? await query(`SELECT * FROM warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC`, [id, userId])
      : await query(`SELECT * FROM warnings WHERE guild_id=$1 AND active=TRUE ORDER BY created_at DESC LIMIT 100`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

// Bot-accessible LOA list (used by z!loa, /loa)
app.get('/api/guilds/:id/loa/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = userId
      ? await query(`SELECT * FROM loa_requests WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10`, [id, userId])
      : await query(`SELECT * FROM loa_requests WHERE guild_id=$1 AND status IN ('pending','approved','active') ORDER BY created_at DESC LIMIT 50`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

// Bot-accessible analytics summary (used by z!stats)
app.get('/api/guilds/:id/analytics/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const [staffR, strikesR, loaR, promoR] = await Promise.all([
      query('SELECT COUNT(*) FROM staff_members WHERE guild_id=$1 AND is_active=TRUE', [id]),
      query('SELECT COUNT(*) FROM strikes WHERE guild_id=$1 AND active=TRUE', [id]),
      query(`SELECT COUNT(*) FROM loa_requests WHERE guild_id=$1 AND status IN ('approved','active')`, [id]),
      query(`SELECT COUNT(*) FROM promotion_history WHERE guild_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [id]),
    ]);
    res.json({
      totalStaff: parseInt(staffR.rows[0]?.count || '0'),
      activeStrikes: parseInt(strikesR.rows[0]?.count || '0'),
      activeLoa: parseInt(loaR.rows[0]?.count || '0'),
      recentPromotions: parseInt(promoR.rows[0]?.count || '0'),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get saved staff role IDs
app.get('/api/guilds/:id/staff-roles', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ staffRoleIds: [] });
  try {
    const r = await query(`SELECT staff_role_ids FROM server_config WHERE guild_id = $1`, [id]);
    res.json({ staffRoleIds: r.rows[0]?.staff_role_ids || [] });
  } catch { res.json({ staffRoleIds: [] }); }
});

// Import from role
app.post('/api/guilds/:id/staff-roles', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { roleIds } = req.body;
  if (!DISCORD_BOT_TOKEN || !DATABASE_URL) return res.status(400).json({ error: 'Not configured' });
  if (!roleIds?.length) return res.status(400).json({ error: 'No roles selected' });
  try {
    // Persist selected role IDs to server_config so they survive page reloads
    await query(
      `INSERT INTO server_config (guild_id, staff_role_ids) VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET staff_role_ids = $2, updated_at = NOW()`,
      [id, roleIds]
    ).catch(() => {});

    const [membersR, rolesR] = await Promise.all([
      fetch(`${DISCORD_API}/guilds/${id}/members?limit=1000`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }),
      fetch(`${DISCORD_API}/guilds/${id}/roles`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }),
    ]);
    const members = membersR.ok ? await membersR.json() : [];
    const allRoles = rolesR.ok ? await rolesR.json() : [];

    let addedCount = 0;
    for (const roleId of roleIds) {
      const role = allRoles.find(r => r.id === roleId);
      const roleName = role?.name || 'Staff';
      const staffMembers = members.filter(m => m.roles.includes(roleId));

      for (const m of staffMembers) {
        const avatarUrl = m.user.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`;
        await query(
          `INSERT INTO staff_members (guild_id, user_id, username, avatar_url, role, rank)
           VALUES ($1, $2, $3, $4, $5, $5)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET
             username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url,
             role = EXCLUDED.role, rank = EXCLUDED.rank, is_active = TRUE, updated_at = NOW()`,
          [id, m.user.id, m.user.global_name || m.user.username, avatarUrl, roleName]
        );
        addedCount++;
      }
    }
    res.json({ success: true, added: addedCount });
  } catch (err) {
    console.error('[staff-roles]', err);
    res.status(500).json({ error: 'Failed to import staff', details: err.message });
  }
});

// ── 13. Ranks ────────────────────────────────────────────────────────────
app.get('/api/guilds/:id/ranks', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    // Ensure server exists first
    await query(`INSERT INTO servers (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]).catch(() => {});
    const r = await query(`SELECT * FROM ranks WHERE guild_id = $1 ORDER BY level DESC, name ASC`, [id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[ranks]', err);
    res.json([]);
  }
});

app.post('/api/guilds/:id/ranks', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, level, color, discordRoleId, isDefault } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    await query(`INSERT INTO servers (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]).catch(() => {});
    // Enforce rank limit: free=5, premium=unlimited
      const premQR = await query(`SELECT is_premium FROM servers WHERE id=$1`, [id]).catch(() => ({ rows: [] }));
      if (!premQR.rows[0]?.is_premium) {
        const rankCnt = await query(`SELECT COUNT(*) FROM ranks WHERE guild_id=$1`, [id]);
        if (parseInt(rankCnt.rows[0]?.count || '0') >= 5) {
          return res.status(403).json({ error: 'Free plan allows up to 5 ranks. Upgrade to Premium for unlimited ranks.' });
        }
      }
          const r = await query(
      `INSERT INTO ranks (id, guild_id, name, level, color, discord_role_id, is_default)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, name, level ?? 0, color || '#5865F2', discordRoleId || null, !!isDefault]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[rank create]', err);
    res.status(500).json({ error: 'Failed to create rank', details: err.message });
  }
});

app.patch('/api/guilds/:id/ranks/:rankId', requireAuth, async (req, res) => {
  const { id, rankId } = req.params;
  const { name, level, color, discordRoleId } = req.body;
  try {
    const r = await query(
      `UPDATE ranks SET name = COALESCE($3, name), level = COALESCE($4, level),
       color = COALESCE($5, color), discord_role_id = COALESCE($6, discord_role_id)
       WHERE id = $2 AND guild_id = $1 RETURNING *`,
      [id, rankId, name || null, level ?? null, color || null, discordRoleId || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update rank' });
  }
});

app.delete('/api/guilds/:id/ranks/:rankId', requireAuth, async (req, res) => {
  const { id, rankId } = req.params;
  try {
    await query(`DELETE FROM ranks WHERE id = $1 AND guild_id = $2`, [rankId, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete rank' });
  }
});

// ── 14. Strikes ──────────────────────────────────────────────────────────
app.get('/api/guilds/:id/strikes', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM strikes WHERE guild_id = $1 ORDER BY created_at DESC`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/strikes', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, reason, evidence, issuedBy, issuedByName, severity } = req.body;
  if (!userId || !reason || !issuedBy) return res.status(400).json({ error: 'Missing fields' });
  try {
    const r = await query(
      `INSERT INTO strikes (guild_id, user_id, username, reason, evidence, issued_by, issued_by_name, active, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8) RETURNING *`,
      [id, userId, username, reason, evidence, issuedBy, issuedByName, severity || 'strike']
    );
    // Update strike count on staff member
    await query(
      `UPDATE staff_members SET strikes = (SELECT COUNT(*) FROM strikes WHERE guild_id=$1 AND user_id=$2 AND active=TRUE)
       WHERE guild_id=$1 AND user_id=$2`,
      [id, userId]
    ).catch(() => {});
    await logActivity(id, issuedBy, issuedByName, 'strike_issued', { targetId: userId, reason });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[strike create]', err);
    res.status(500).json({ error: 'Failed to create strike' });
  }
});

app.delete('/api/guilds/:id/strikes/:strikeId', requireAuth, async (req, res) => {
  const { id, strikeId } = req.params;
  const { removedBy, removedByName, removalReason } = req.body || {};
  const removerId = removedBy || req.session?.user?.id || 'system';
  const removerName = removedByName || req.session?.user?.username || 'system';
  try {
    await query(
      `UPDATE strikes SET active = FALSE, removed_at = NOW(), removed_by = $3,
       removed_by_name = $4, removal_reason = $5
       WHERE id = $1 AND guild_id = $2`,
      [strikeId, id, removerId, removerName, removalReason || null]
    );
    // Update strike count on staff member
    const strikeRow = await query(`SELECT user_id FROM strikes WHERE id=$1`, [strikeId]).catch(() => ({ rows: [] }));
    if (strikeRow.rows[0]?.user_id) {
      await query(
        `UPDATE staff_members SET strikes = (SELECT COUNT(*) FROM strikes WHERE guild_id=$1 AND user_id=$2 AND active=TRUE)
         WHERE guild_id=$1 AND user_id=$2`,
        [id, strikeRow.rows[0].user_id]
      ).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke strike' });
  }
});

// ── 15. LOA ──────────────────────────────────────────────────────────────
app.get('/api/guilds/:id/loa', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM loa_requests WHERE guild_id = $1 ORDER BY created_at DESC`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/loa', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, reason, startDate, endDate } = req.body;
  if (!userId || !reason || !startDate || !endDate) return res.status(400).json({ error: 'Missing fields' });
  try {
    const r = await query(
      `INSERT INTO loa_requests (guild_id, user_id, username, reason, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [id, userId, username, reason, new Date(startDate), new Date(endDate)]
    );
    await logActivity(id, userId, username, 'loa_request', { startDate, endDate });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[loa create]', err);
    res.status(500).json({ error: 'Failed to create LOA request' });
  }
});

app.patch('/api/guilds/:id/loa/:loaId', requireAuth, async (req, res) => {
  const { id, loaId } = req.params;
  const { status, approvedBy, approvedByName } = req.body;
  try {
    const r = await query(
      `UPDATE loa_requests SET status = $1, approved_by = $2, approved_by_name = $3
       WHERE id = $4 AND guild_id = $5 RETURNING *`,
      [status, approvedBy, approvedByName, loaId, id]
    );
    await logActivity(id, approvedBy, approvedByName, `loa_${status}`, { loaId });
    const loaRow = r.rows[0];
      // Assign or remove Discord LOA role when status changes
      if (DISCORD_BOT_TOKEN && loaRow?.user_id && DATABASE_URL) {
        try {
          const cfgQ = await query('SELECT on_loa_role_id FROM server_config WHERE guild_id = $1', [id]);
          const roleId = cfgQ.rows[0]?.on_loa_role_id;
          if (roleId) {
            const method = (status === 'approved' || status === 'active') ? 'PUT' : 'DELETE';
            if (method === 'PUT' || status === 'denied' || status === 'returned' || status === 'expired') {
              await fetch(`${DISCORD_API}/guilds/${id}/members/${loaRow.user_id}/roles/${roleId}`, {
                method,
                headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': `LOA ${status} — Zenith` },
                body: method === 'PUT' ? '{}' : undefined,
              }).catch(e => console.error('[loa-role]', e.message));
            }
          }
        } catch (roleErr) { console.error('[loa-role]', roleErr.message); }
      }
      res.json(loaRow);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update LOA' });
  }
});

// ── 16. Activity Logs ────────────────────────────────────────────────────
async function logActivity(guildId, userId, username, action, details) {
  if (!DATABASE_URL) return;
  try {
    await query(
      `INSERT INTO activity_logs (guild_id, user_id, username, action, details) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [guildId, userId || null, username || null, action, JSON.stringify(details || {})]
    );
  } catch {}
}

app.get('/api/guilds/:id/activity', requireAuth, async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT * FROM activity_logs WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [id, limit]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/activity', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, action, details } = req.body;
  await logActivity(id, userId, username, action, details);
  res.json({ success: true });
});

// ── 17. Audit Logs ───────────────────────────────────────────────────────
app.get('/api/guilds/:id/audit-logs', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DISCORD_BOT_TOKEN) return res.status(400).json({ error: 'Bot token not configured' });
  try {
    const [discordRes, botStrikesRes, botLoaRes, botActivityRes] = await Promise.all([
      fetch(`${DISCORD_API}/guilds/${id}/audit-logs?limit=50`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      }),
      DATABASE_URL ? query(`SELECT * FROM strikes WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 30`, [id]) : { rows: [] },
      DATABASE_URL ? query(`SELECT * FROM loa_requests WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]) : { rows: [] },
      DATABASE_URL ? query(`SELECT * FROM activity_logs WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 30`, [id]) : { rows: [] },
    ]);

    const discordData = discordRes.ok ? await discordRes.json() : { audit_log_entries: [], users: [] };
    const usersById = new Map((discordData.users || []).map(u => [u.id, u]));

    const combined = [
      ...(discordData.audit_log_entries || []).map(entry => {
        const actor = usersById.get(entry.user_id);
        const actionName = AUDIT_ACTION_MAP[entry.action_type] || `Action ${entry.action_type}`;
        return {
          id: entry.id, type: 'discord',
          action: actionName.toLowerCase().replace(/_/g, '-'),
          action_name: actionName.replace(/_/g, ' '),
          user: entry.user_id,
          user_name: actor?.global_name || actor?.username || entry.user_id || 'Unknown',
          target: entry.target_id,
          reason: entry.reason || 'No reason provided',
          timestamp: new Date(Number(BigInt(entry.id) / 4194304n) + 1420070400000).toISOString(),
        };
      }),
      ...botStrikesRes.rows.map(s => ({
        id: `strike-${s.id}`, type: 'strike',
        action: 'strike-issued', action_name: `Strike ${s.active ? 'Issued' : 'Revoked'}`,
        user: s.issued_by, user_name: s.issued_by_name || s.issued_by,
        target: s.user_id, target_name: s.username,
        reason: s.reason, timestamp: s.created_at,
      })),
      ...botLoaRes.rows.map(l => ({
        id: `loa-${l.id}`, type: 'loa',
        action: 'loa-request', action_name: `LOA Request (${l.status})`,
        user: l.user_id, user_name: l.username,
        target: l.user_id, target_name: l.username,
        reason: l.reason, timestamp: l.created_at,
      })),
      ...botActivityRes.rows.map(a => ({
        id: `act-${a.id}`, type: 'activity',
        action: a.action, action_name: a.action.replace(/_/g, ' '),
        user: a.user_id, user_name: a.username,
        target: null, reason: JSON.stringify(a.details),
        timestamp: a.created_at,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(combined.slice(0, 100));
  } catch (err) {
    console.error('[audit-logs]', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ── 18. Applications Config ───────────────────────────────────────────────
const DEFAULT_APP_CFG = {
  enabled: false, channel: '', reviewChannel: '', title: '', questions: [],
  requireRecommendations: false, autoReject: false, reviewerRoleIds: [], apakKey: null
};

app.get('/api/guilds/:id/applications-config', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ enabled: false, channel: '', questions: [] });
  try {
    const r = await query(
      `SELECT sc.applications_enabled, sc.applications_channel_id, sc.applications_review_channel_id,
              sc.applications_title, sc.applications_questions, sc.require_recommendations, sc.auto_reject,
              sc.panel_description, sc.button_label, sc.account_age_limit, sc.server_time_limit, sc.rejection_cooldown,
              sc.applications_embed_color,
              s.reviewer_role_ids, s.apak_key, s.name
       FROM servers s LEFT JOIN server_config sc ON s.id = sc.guild_id WHERE s.id = $1`, [id]
    );
    if (r.rows.length === 0) {
      // Create server entry if it doesn't exist
      await query(`INSERT INTO servers (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [id]);
      return res.json(DEFAULT_APP_CFG);
    }
    const row = r.rows[0];
    res.json({
      enabled: !!row.applications_enabled, channel: row.applications_channel_id || '',
      reviewChannel: row.applications_review_channel_id || '',
      title: row.applications_title || '', questions: row.applications_questions || [],
      requireRecommendations: !!row.require_recommendations, autoReject: !!row.auto_reject,
      panelDescription: row.panel_description || '',
      buttonLabel: row.button_label || 'Apply Now',
      accountAgeLimit: row.account_age_limit || 0,
      serverTimeLimit: row.server_time_limit || 0,
      rejectionCooldown: row.rejection_cooldown || 0,
      reviewerRoleIds: row.reviewer_role_ids || [],
      apakKey: row.apak_key || null,
      embedColor: row.applications_embed_color || '#d4af37',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

app.post('/api/guilds/:id/applications-config', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { 
    enabled, channel, reviewChannel, title, questions = [], 
    requireRecommendations = false, autoReject = false, reviewerRoleIds = [],
    panelDescription = '', buttonLabel = 'Apply Now', 
    accountAgeLimit = 0, serverTimeLimit = 0, rejectionCooldown = 0,
    embedColor = '#d4af37'
  } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    // Generate APAK if not exists
    const sR = await query(`SELECT apak_key FROM servers WHERE id = $1`, [id]);
    let apak = sR.rows[0]?.apak_key;
    if (!apak) {
      apak = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await query(`UPDATE servers SET apak_key = $1 WHERE id = $2`, [apak, id]);
    }

    await query(
      `INSERT INTO server_config (guild_id, applications_enabled, applications_channel_id,
         applications_review_channel_id, applications_title, applications_questions,
         require_recommendations, auto_reject, panel_description, button_label,
         account_age_limit, server_time_limit, rejection_cooldown, applications_embed_color)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (guild_id) DO UPDATE SET
         applications_enabled = $2, applications_channel_id = $3,
         applications_review_channel_id = $4, applications_title = $5,
         applications_questions = $6::jsonb, require_recommendations = $7,
         auto_reject = $8, panel_description = $9, button_label = $10,
         account_age_limit = $11, server_time_limit = $12, rejection_cooldown = $13,
         applications_embed_color = $14,
         updated_at = NOW()`,
      [
        id, !!enabled, channel || null, reviewChannel || null, title || null,
        JSON.stringify(questions), !!requireRecommendations, !!autoReject,
        panelDescription || null, buttonLabel || 'Apply Now',
        parseInt(accountAgeLimit) || 0, parseInt(serverTimeLimit) || 0, parseInt(rejectionCooldown) || 0,
        embedColor || '#d4af37'
      ]
    );

    await query(`UPDATE servers SET reviewer_role_ids = $1 WHERE id = $2`, [reviewerRoleIds, id]);

    res.json({ success: true, apakKey: apak });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save applications config' });
  }
});

// ── 18.5 Bot Customization ──────────────────────────────────────────────
app.get('/api/guilds/:id/bot-customization', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ isPremium: false });
  try {
    const r = await query(`SELECT is_premium, custom_bot_name, custom_bot_avatar, custom_bot_status FROM servers WHERE id = $1`, [id]);
    const row = r.rows[0] || {};
    res.json({
      isPremium: !!row.is_premium,
      customBotName: row.custom_bot_name || '',
      customBotAvatar: row.custom_bot_avatar || '',
      customBotStatus: row.custom_bot_status || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bot customization' });
  }
});

app.post('/api/guilds/:id/bot-customization', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { customBotName, customBotAvatar, customBotStatus } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    // Verify premium first
    const pR = await query(`SELECT is_premium FROM servers WHERE id = $1`, [id]);
    if (!pR.rows[0]?.is_premium) return res.status(403).json({ error: 'Premium required' });

    await query(
      `UPDATE servers SET custom_bot_name = $1, custom_bot_avatar = $2, custom_bot_status = $3, updated_at = NOW() WHERE id = $4`,
      [customBotName || null, customBotAvatar || null, customBotStatus || null, id]
    );
        // Apply bot name/avatar to Discord via REST API (best-effort, rate-limited)
      if (process.env.DISCORD_BOT_TOKEN && (customBotName || customBotAvatar)) {
        const patch = {};
        if (customBotName && customBotName.trim()) patch.username = customBotName.trim();
        if (customBotAvatar && customBotAvatar.startsWith('data:')) patch.avatar = customBotAvatar;
        if (customBotAvatar && customBotAvatar.startsWith('http')) {
          try {
            const imgRes = await fetch(customBotAvatar);
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const ct = imgRes.headers.get('content-type') || 'image/png';
              patch.avatar = `data:${ct};base64,${buf.toString('base64')}`;
            }
          } catch {}
        }
        // NOTE: We intentionally do NOT call /users/@me PATCH to change the global bot identity.
        // That would affect all servers. Instead, per-server customization is surfaced via
        // webhooks or nickname changes only — the stored name/avatar is used for webhook messages.
        // Changing the global bot username here is a known loophole that breaks other servers.
      }
      res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save bot customization' });
  }
});

// ── 19. Settings ─────────────────────────────────────────────────────────
app.get('/api/guilds/:id/settings', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({});
  try {
    const r = await query(`SELECT settings FROM servers WHERE id = $1`, [id]);
    res.json(r.rows[0]?.settings || {});
  } catch { res.json({}); }
});

app.post('/api/guilds/:id/settings', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await query(
      `INSERT INTO servers (id, name, settings) VALUES ($1, $1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = servers.settings || $2::jsonb`,
      [id, JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ── 20. Bot Stats ──────────────────────────────────────────────────────
app.get('/api/bot/stats', async (_req, res) => {
  try {
    if (!DATABASE_URL) return res.json({ guilds: 0, users: 0, status: 'Online' });
    const [gR, uR] = await Promise.all([
      query('SELECT COUNT(*) FROM servers WHERE bot_added = TRUE'),
      query('SELECT COUNT(*) FROM users'),
    ]);
    res.json({ guilds: gR.rows[0].count, users: uR.rows[0].count, status: 'Online' });
  } catch { res.json({ guilds: 0, users: 0, status: 'Online' }); }
});

// ── 20.5 Application Portal (APAK) ──────────────────────────────────────
app.get('/api/portal/:apak/access', requireAuth, async (req, res) => {
  const { apak } = req.params;
  const userId = req.session.user.id;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });

  try {
    const gR = await query(`SELECT id, name, reviewer_role_ids, owner_id FROM servers WHERE apak_key = $1`, [apak]);
    if (gR.rows.length === 0) return res.status(404).json({ error: 'Portal not found' });
    const guild = gR.rows[0];

    // Check if owner
    if (guild.owner_id === userId) return res.json({ guild });

    // Check roles
    const reviewerRoles = guild.reviewer_role_ids || [];
    if (reviewerRoles.length === 0) return res.status(403).json({ error: 'No reviewer roles configured' });

    // Fetch user roles in that guild
    const mR = await fetch(`${DISCORD_API}/guilds/${guild.id}/members/${userId}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!mR.ok) return res.status(403).json({ error: 'You are not a member of this server' });
    const member = await mR.json();
    const userRoles = member.roles || [];

    const isReviewer = userRoles.some(r => reviewerRoles.includes(r));
    if (!isReviewer) {
      return res.status(403).json({ 
        error: 'You do not have any of the required roles to access this portal.',
        requiredRoles: reviewerRoles 
      });
    }

    res.json({ guild });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/portal/:apak/submissions', requireAuth, async (req, res) => {
  const { apak } = req.params;
  try {
    const gR = await query(`SELECT id FROM servers WHERE apak_key = $1`, [apak]);
    if (gR.rows.length === 0) return res.status(404).json({ error: 'Portal not found' });
    const guildId = gR.rows[0].id;

    const sR = await query(
      `SELECT * FROM application_submissions WHERE guild_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [guildId]
    );
    res.json(sR.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// ── 21. Staff Portal ────────────────────────────────────────────────────
app.get('/api/staff/guilds', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const r = await query(
      `SELECT DISTINCT sm.guild_id, s.name, s.icon, sm.role as rank
       FROM staff_members sm LEFT JOIN servers s ON sm.guild_id = s.id
       WHERE sm.user_id = $1 AND sm.is_active = TRUE ORDER BY s.name ASC`,
      [userId]
    );
    res.json(r.rows || []);
  } catch { res.json([]); }
});

app.post('/api/staff/verify-roblox', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { robloxUsername, guildId } = req.body;
  if (!robloxUsername || !guildId) return res.status(400).json({ error: 'Missing fields' });
  try {
    await query(`UPDATE users SET roblox_username = $1, roblox_verified = TRUE WHERE id = $2`, [robloxUsername, userId]);
    await query(
      `INSERT INTO staff_portal_sessions (user_id, guild_id, roblox_verified_at) VALUES ($1,$2,NOW())
       ON CONFLICT (user_id, guild_id) DO UPDATE SET roblox_verified_at = NOW()`,
      [userId, guildId]
    );
    res.json({ success: true, robloxUsername });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify' });
  }
});

app.get('/api/staff/profile/:robloxUsername', async (req, res) => {
  const { robloxUsername } = req.params;
  try {
    const userR = await query(`SELECT id, username, avatar, roblox_username FROM users WHERE roblox_username = $1`, [robloxUsername]);
    if (!userR.rows[0]) return res.status(404).json({ error: 'Not found' });
    const user = userR.rows[0];
    const staffR = await query(
      `SELECT sm.guild_id, s.name as guild_name, s.icon, sm.role, sm.joined_at, sm.strikes
       FROM staff_members sm LEFT JOIN servers s ON sm.guild_id = s.id
       WHERE sm.user_id = $1 AND sm.is_active = TRUE ORDER BY sm.joined_at DESC`,
      [user.id]
    );
    res.json({ ...user, staffPositions: staffR.rows, totalServers: staffR.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// ── NEW FEATURES: FREE + FREEMIUM + PREMIUM ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ── ADMIN: Global Stats (used by /support stats command) ─────────────────
app.get('/api/admin/stats', requireBotSecret, async (_req, res) => {
  if (!DATABASE_URL) return res.json({ totalGuilds: 0, premiumGuilds: 0, totalStaff: 0, totalStrikes: 0, totalWarnings: 0, totalActiveLoa: 0 });
  try {
    const [gR, pgR, sR, stR, wR, lR] = await Promise.all([
      query('SELECT COUNT(*) FROM servers'),
      query('SELECT COUNT(*) FROM servers WHERE is_premium = TRUE'),
      query('SELECT COUNT(*) FROM staff_members WHERE is_active = TRUE'),
      query('SELECT COUNT(*) FROM strikes WHERE active = TRUE'),
      query('SELECT COUNT(*) FROM warnings WHERE active = TRUE'),
      query("SELECT COUNT(*) FROM loa_requests WHERE status IN ('pending','approved','active')"),
    ]);
    res.json({
      totalGuilds:    parseInt(gR.rows[0].count)  || 0,
      premiumGuilds:  parseInt(pgR.rows[0].count) || 0,
      totalStaff:     parseInt(sR.rows[0].count)  || 0,
      totalStrikes:   parseInt(stR.rows[0].count) || 0,
      totalWarnings:  parseInt(wR.rows[0].count)  || 0,
      totalActiveLoa: parseInt(lR.rows[0].count)  || 0,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Announce to all guilds (queued, bot picks up via webhook) ──────
const announceQueue = [];
app.post('/api/admin/announce', requireBotSecret, async (req, res) => {
  const { message, sentBy } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const targetCount = DATABASE_URL
      ? parseInt((await query('SELECT COUNT(*) FROM servers WHERE bot_added = TRUE')).rows[0].count) || 0
      : 0;
    announceQueue.push({ message, sentBy, timestamp: new Date(), targetCount });
    res.json({ ok: true, targetCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/admin/announce-queue', requireBotSecret, (_req, res) => {
  res.json(announceQueue.splice(0, 5)); // drain queue up to 5 items
});

// ── FEATURE 1 (FREE): Promotion/Demotion History ─────────────────────────
app.get('/api/guilds/:id/promotions', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT * FROM promotion_history WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/promotions', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, type, fromRank, toRank, toRankName, reason, promotedBy, promotedByName, promotedById, discordRoleId } = req.body;
  const resolvedToRank = toRank || toRankName;
  const resolvedPromotedBy = promotedBy || promotedById || req.session?.user?.id;
  const resolvedPromotedByName = promotedByName || req.session?.user?.username || 'Unknown';
  if (!userId || !type || !resolvedToRank) return res.status(400).json({ error: 'Missing required fields: userId, type, toRank' });
  try {
    // Update staff member rank
    await query(
      `UPDATE staff_members SET rank = $1, role = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3`,
      [resolvedToRank, id, userId]
    );
    // Log it
    const r = await query(
      `INSERT INTO promotion_history (guild_id, user_id, username, type, from_rank, to_rank, reason, promoted_by, promoted_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, userId, username, type || 'promotion', fromRank || null, resolvedToRank, reason || null, resolvedPromotedBy, resolvedPromotedByName]
    );
    // Sync Discord role if configured and bot token available
    if (discordRoleId && DISCORD_BOT_TOKEN) {
      await fetch(`${DISCORD_API}/guilds/${id}/members/${userId}/roles/${discordRoleId}`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': `${type} to ${resolvedToRank} — Zenith` },
        body: '{}',
      }).catch(() => {});
    }
    await logActivity(id, resolvedPromotedBy, resolvedPromotedByName, `staff_${type || 'promotion'}`, { userId, fromRank, toRank: resolvedToRank });

    // Send DM card to the promoted/demoted user via Discord API
    if (DISCORD_BOT_TOKEN && userId) {
      (async () => {
        try {
          // Fetch embed config for this server
          const cfgR = await query(`SELECT embed_color, embed_footer FROM server_config WHERE guild_id = $1`, [id]).catch(() => ({ rows: [] }));
          const embedColor = cfgR.rows[0]?.embed_color || '#d4af37';
          const embedFooter = cfgR.rows[0]?.embed_footer || 'Zenith Staff Management';
          const isPromo = (type || 'promotion') === 'promotion';
          const color = isPromo ? 0x57F287 : 0xED4245;
          const emoji = isPromo ? '📈' : '📉';
          const title = isPromo ? `${emoji} Congratulations on your Promotion!` : `${emoji} Staff Role Update`;
          const desc = isPromo
            ? `You have been promoted to **${toRank}** in your server!${fromRank ? `\n*Previous rank: ${fromRank}*` : ''}${reason ? `\n\n**Reason:** ${reason}` : ''}`
            : `Your rank has been updated to **${toRank}**${fromRank ? ` from ${fromRank}` : ''}.${reason ? `\n\n**Reason:** ${reason}` : ''}`;

          // Open DM channel
          const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
            method: 'POST',
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id: userId }),
          });
          if (dmRes.ok) {
            const dm = await dmRes.json();
            await fetch(`${DISCORD_API}/channels/${dm.id}/messages`, {
              method: 'POST',
              headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [{
                  color,
                  title,
                  description: desc,
                  fields: [
                    ...(fromRank ? [{ name: 'Previous Rank', value: fromRank, inline: true }] : []),
                    { name: 'New Rank', value: toRank, inline: true },
                    ...(promotedByName ? [{ name: isPromo ? 'Promoted By' : 'Actioned By', value: promotedByName, inline: true }] : []),
                  ],
                  footer: { text: embedFooter },
                  timestamp: new Date().toISOString(),
                }],
              }),
            }).catch(() => {});
          }
        } catch { /* DMs may be disabled */ }
      })();
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error('[promotions]', err);
    res.status(500).json({ error: 'Failed to record promotion' });
  }
});

// ── FEATURE 2 (FREEMIUM): Shift Tracking ─────────────────────────────────
// Free: last 10 shifts stored. Premium: unlimited retention.
app.get('/api/guilds/:id/shifts', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!DATABASE_URL) return res.json([]);
  try {
    const isPremQ = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id = $1', [id]);
    const isPrem  = !!isPremQ.rows[0]?.is_premium && (!isPremQ.rows[0]?.premium_expires_at || new Date(isPremQ.rows[0].premium_expires_at) > new Date());
    const limit   = isPrem ? 'ALL' : '50';
    const r = userId
      ? await query(`SELECT * FROM shifts WHERE guild_id=$1 AND user_id=$2 ORDER BY started_at DESC LIMIT ${limit}`, [id, userId])
      : await query(`SELECT * FROM shifts WHERE guild_id=$1 ORDER BY started_at DESC LIMIT ${limit}`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/shifts/start', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, shiftType, notes } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    // End any open shift first
    await query(`UPDATE shifts SET ended_at = NOW(), duration_mins = EXTRACT(EPOCH FROM (NOW() - started_at))/60 WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NULL`, [id, userId]).catch(() => {});
    const r = await query(
      `INSERT INTO shifts (guild_id, user_id, username, shift_type, notes, started_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [id, userId, username, shiftType || 'general', notes || null]
    );
    await logActivity(id, userId, username, 'shift_start', {});
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[shift start]', err); res.status(500).json({ error: err.message || 'Failed to start shift' });
  }
});

app.post('/api/guilds/:id/shifts/end', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const r = await query(
      `UPDATE shifts SET ended_at = NOW(), duration_mins = EXTRACT(EPOCH FROM (NOW() - started_at))/60
       WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING *`,
      [id, userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'No active shift found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[shift end]', err); res.status(500).json({ error: err.message || 'Failed to end shift' });
  }
});

app.get('/api/guilds/:id/shifts/active', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM shifts WHERE guild_id=$1 AND ended_at IS NULL`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

// Active shift for a specific user — used by bot /shift status
app.get('/api/guilds/:id/shifts/active/:userId', requireBotOrAuth, async (req, res) => {
  const { id, userId } = req.params;
  if (!DATABASE_URL) return res.status(404).json({ error: 'No database' });
  try {
    const r = await query(`SELECT * FROM shifts WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NULL LIMIT 1`, [id, userId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'No active shift' });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Failed to fetch active shift' }); }
});

// ── FEATURE 3 (PREMIUM): Divisions System ────────────────────────────────
app.get('/api/guilds/:id/divisions', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM divisions WHERE guild_id=$1 AND is_active=TRUE ORDER BY name ASC`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/divisions', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, description, discordRoleId, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const pR = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id=$1', [id]);
    const isPrem = !!pR.rows[0]?.is_premium && (!pR.rows[0]?.premium_expires_at || new Date(pR.rows[0].premium_expires_at) > new Date());
    if (!isPrem) {
      const count = await query('SELECT COUNT(*) FROM divisions WHERE guild_id=$1 AND is_active=TRUE', [id]);
      if (parseInt(count.rows[0].count) >= 3) {
        return res.status(403).json({ error: 'Free plan limited to 3 divisions. Upgrade to Premium for unlimited divisions.' });
      }
    }
    // Enforce division limit: free=5, premium=50
      const premQD = await query(`SELECT is_premium FROM servers WHERE id=$1`, [id]).catch(() => ({ rows: [] }));
      const isPremD = !!premQD.rows[0]?.is_premium;
      const divCnt = await query(`SELECT COUNT(*) FROM divisions WHERE guild_id=$1 AND is_active=TRUE`, [id]);
      const divLimit = isPremD ? 50 : 5;
      if (parseInt(divCnt.rows[0]?.count || '0') >= divLimit) {
        return res.status(403).json({ error: `${isPremD ? 'Premium' : 'Free'} plan allows up to ${divLimit} divisions.` });
      }
          const r = await query(
      `INSERT INTO divisions (guild_id, name, description, discord_role_id, color)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, name, description || null, discordRoleId || null, color || '#5865F2']
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create division' });
  }
});

app.patch('/api/guilds/:id/divisions/:divId', requireAuth, async (req, res) => {
  const { id, divId } = req.params;
  const { name, description, discordRoleId, color } = req.body;
  try {
    const r = await query(
      `UPDATE divisions SET name=COALESCE($3,name), description=COALESCE($4,description), discord_role_id=COALESCE($5,discord_role_id), color=COALESCE($6,color)
       WHERE id=$2 AND guild_id=$1 RETURNING *`,
      [id, divId, name||null, description||null, discordRoleId||null, color||null]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to update division' }); }
});

app.delete('/api/guilds/:id/divisions/:divId', requireAuth, async (req, res) => {
  const { id, divId } = req.params;
  try {
    await query(`UPDATE divisions SET is_active=FALSE WHERE id=$1 AND guild_id=$2`, [divId, id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete division' }); }
});

// Assign division to a staff member
app.patch('/api/guilds/:id/staff/:userId/division', requireAuth, async (req, res) => {
  const { id, userId } = req.params;
  const { divisionId, divisionName } = req.body;
  try {
    await query(`UPDATE staff_members SET division=$3, updated_at=NOW() WHERE guild_id=$1 AND user_id=$2`, [id, userId, divisionName || null]);
    if (divisionId && DISCORD_BOT_TOKEN) {
      const divR = await query('SELECT discord_role_id FROM divisions WHERE id=$1', [divisionId]);
      const roleId = divR.rows[0]?.discord_role_id;
      if (roleId) {
        await fetch(`${DISCORD_API}/guilds/${id}/members/${userId}/roles/${roleId}`, {
          method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': 'Division assigned — Zenith' }, body: '{}',
        }).catch(() => {});
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to assign division' }); }
});

// ── FEATURE 4 (PREMIUM): Performance Reviews ─────────────────────────────
app.get('/api/guilds/:id/performance', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = userId
      ? await query(`SELECT * FROM performance_reviews WHERE guild_id=$1 AND target_user_id=$2 ORDER BY created_at DESC`, [id, userId])
      : await query(`SELECT * FROM performance_reviews WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 100`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.get('/api/guilds/:id/performance/leaderboard', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT target_user_id, target_username, AVG(rating) as avg_rating, COUNT(*) as review_count
       FROM performance_reviews WHERE guild_id=$1
       GROUP BY target_user_id, target_username ORDER BY avg_rating DESC LIMIT 10`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/performance', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { targetUserId, targetUsername, rating, comments, reviewerUsername, reviewerId } = req.body;
  if (!targetUserId || !rating) return res.status(400).json({ error: 'Missing fields' });
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const pR = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id=$1', [id]);
    const isPrem = !!pR.rows[0]?.is_premium && (!pR.rows[0]?.premium_expires_at || new Date(pR.rows[0].premium_expires_at) > new Date());
    if (!isPrem) {
      // Free: max 3 reviews per staff member
      const count = await query('SELECT COUNT(*) FROM performance_reviews WHERE guild_id=$1 AND target_user_id=$2', [id, targetUserId]);
      if (parseInt(count.rows[0].count) >= 3) {
        return res.status(403).json({ error: 'Free plan: max 3 reviews per staff member. Upgrade to Premium for unlimited reviews.' });
      }
    }
    const r = await query(
      `INSERT INTO performance_reviews (guild_id, target_user_id, target_username, reviewer_id, reviewer_username, rating, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, targetUserId, targetUsername, reviewerId, reviewerUsername, Math.min(5, Math.max(1, rating)), comments || '']
    );
    await logActivity(id, reviewerId, reviewerUsername, 'performance_review', { targetUserId, rating });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[performance review]', err); res.status(500).json({ error: err.message || 'Failed to submit review' });
  }
});

// ── FEATURE 5 (PREMIUM): Strike Automation ───────────────────────────────
app.get('/api/guilds/:id/strike-automation', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ enabled: false });
  try {
    const pR = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id=$1', [id]);
    const isPrem = !!pR.rows[0]?.is_premium && (!pR.rows[0]?.premium_expires_at || new Date(pR.rows[0].premium_expires_at) > new Date());
    if (!isPrem) return res.status(403).json({ error: 'Strike Automation is a Premium feature.' });
    const r = await query('SELECT * FROM strike_automation WHERE guild_id=$1', [id]);
    res.json(r.rows[0] || { enabled: false, threshold: 3, action: 'dm_warn', dm_message: '' });
  } catch { res.json({ enabled: false }); }
});

app.post('/api/guilds/:id/strike-automation', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { enabled, threshold, action, dmMessage, removeRoleId } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const pR = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id=$1', [id]);
    const isPrem = !!pR.rows[0]?.is_premium && (!pR.rows[0]?.premium_expires_at || new Date(pR.rows[0].premium_expires_at) > new Date());
    if (!isPrem) return res.status(403).json({ error: 'Strike Automation is a Premium feature.' });
    await query(
      `INSERT INTO strike_automation (guild_id, enabled, threshold, action, dm_message, remove_role_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (guild_id) DO UPDATE SET enabled=$2, threshold=$3, action=$4, dm_message=$5, remove_role_id=$6`,
      [id, !!enabled, threshold || 3, action || 'dm_warn', dmMessage || '', removeRoleId || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save automation config' });
  }
});

// Bot calls this after issuing a strike to check if automation should trigger
app.post('/api/guilds/:id/strike-automation/check', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username } = req.body;
  if (!DATABASE_URL) return res.json({ triggered: false });
  try {
    const [autoR, countR] = await Promise.all([
      query('SELECT * FROM strike_automation WHERE guild_id=$1 AND enabled=TRUE', [id]),
      query('SELECT COUNT(*) FROM strikes WHERE guild_id=$1 AND user_id=$2 AND active=TRUE', [id, userId]),
    ]);
    const auto = autoR.rows[0];
    const count = parseInt(countR.rows[0].count);
    if (!auto || count < auto.threshold) return res.json({ triggered: false, count });

    // Trigger the automation
    const actions = [];
    if (DISCORD_BOT_TOKEN) {
      if (auto.action === 'dm_warn' || auto.action === 'dm_and_role') {
        // Send DM
        const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
          method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient_id: userId }),
        }).catch(() => null);
        if (dmRes?.ok) {
          const dm = await dmRes.json();
          await fetch(`${DISCORD_API}/channels/${dm.id}/messages`, {
            method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: auto.dm_message || `⚠️ You have reached ${count} active strikes. Please contact management immediately.` }),
          }).catch(() => {});
          actions.push('dm_sent');
        }
      }
      if ((auto.action === 'remove_role' || auto.action === 'dm_and_role') && auto.remove_role_id) {
        await fetch(`${DISCORD_API}/guilds/${id}/members/${userId}/roles/${auto.remove_role_id}`, {
          method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'X-Audit-Log-Reason': `Strike threshold reached — Zenith` },
        }).catch(() => {});
        actions.push('role_removed');
      }
    }
    await logActivity(id, null, 'Zenith Automation', 'strike_automation_triggered', { userId, username, count, actions });
    res.json({ triggered: true, count, actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FEATURE 6 (PREMIUM): Advanced Analytics ──────────────────────────────
app.get('/api/guilds/:id/analytics', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const pR = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id=$1', [id]);
    const isPrem = !!pR.rows[0]?.is_premium && (!pR.rows[0]?.premium_expires_at || new Date(pR.rows[0].premium_expires_at) > new Date());

    const [staffR, strikesR, loaR, promoR, activityR, shiftsR] = await Promise.all([
      query('SELECT COUNT(*) FROM staff_members WHERE guild_id=$1 AND is_active=TRUE', [id]),
      query('SELECT COUNT(*) FROM strikes WHERE guild_id=$1 AND active=TRUE', [id]),
      query("SELECT COUNT(*) FROM loa_requests WHERE guild_id=$1 AND status IN ('approved','active')", [id]),
      query("SELECT COUNT(*) FROM promotion_history WHERE guild_id=$1 AND created_at > NOW() - INTERVAL '30 days'", [id]),
      query('SELECT action, COUNT(*) FROM activity_logs WHERE guild_id=$1 GROUP BY action ORDER BY count DESC LIMIT 10', [id]),
      query('SELECT COALESCE(SUM(duration_mins),0) as total_mins, COUNT(*) as total_shifts FROM shifts WHERE guild_id=$1', [id]).catch(() => ({ rows: [{ total_mins: 0, total_shifts: 0 }] })),
    ]);

    // Premium: include trend data (last 7 days)
    let trends = [];
    if (isPrem) {
      const tR = await query(
        `SELECT DATE(created_at) as date, COUNT(*) as count FROM activity_logs WHERE guild_id=$1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date`,
        [id]
      );
      trends = tR.rows;
    }

    // Top performers (staff with most shifts)
    const topR = await query(
      `SELECT sm.username, sm.user_id, COALESCE(SUM(sh.duration_mins),0) as total_mins, COALESCE(COUNT(sh.id),0) as shift_count, COALESCE(sm.strikes,0) as strike_count
       FROM staff_members sm LEFT JOIN shifts sh ON sh.guild_id=sm.guild_id AND sh.user_id=sm.user_id AND sh.ended_at IS NOT NULL
       WHERE sm.guild_id=$1 AND sm.is_active=TRUE GROUP BY sm.user_id, sm.username, sm.strikes ORDER BY total_mins DESC LIMIT 5`,
      [id]
    );

    // Fetch extra premium stats
    let commendationCount = 0, warnCount = 0, divisionCount = 0, avgShiftMins = 0;
    if (isPrem) {
      const [commR, warnR, divR] = await Promise.all([
        query('SELECT COUNT(*) FROM commendations WHERE guild_id=$1', [id]).catch(() => ({ rows: [{ count: 0 }] })),
        query('SELECT COUNT(*) FROM warnings WHERE guild_id=$1 AND active=TRUE', [id]).catch(() => ({ rows: [{ count: 0 }] })),
        query('SELECT COUNT(*) FROM divisions WHERE guild_id=$1 AND is_active=TRUE', [id]).catch(() => ({ rows: [{ count: 0 }] })),
      ]);
      commendationCount = parseInt(commR.rows[0].count) || 0;
      warnCount         = parseInt(warnR.rows[0].count) || 0;
      divisionCount     = parseInt(divR.rows[0].count)  || 0;
      const totalMins   = Math.round(parseFloat(shiftsR.rows[0].total_mins) || 0);
      const totalShifts = parseInt(shiftsR.rows[0].total_shifts) || 0;
      avgShiftMins      = totalShifts > 0 ? Math.round(totalMins / totalShifts) : 0;
    }

    const totalShiftMins = Math.round(parseFloat(shiftsR.rows[0].total_mins) || 0);
    const totalShifts    = parseInt(shiftsR.rows[0].total_shifts) || 0;

    res.json({
      isPremium: isPrem,
      // Flat fields for frontend compatibility
      staffCount:         parseInt(staffR.rows[0].count)   || 0,
      activeStrikes:      parseInt(strikesR.rows[0].count) || 0,
      activeLoaCount:     parseInt(loaR.rows[0].count)     || 0,
      promotionsThisMonth:parseInt(promoR.rows[0].count)   || 0,
      totalShiftMins,
      totalShifts,
      avgShiftMins,
      commendationCount,
      warnCount,
      divisionCount,
      topActivity:     activityR.rows,
      topPerformers:   topR.rows,
      trends:          isPrem ? trends : [],
      // Also keep nested summary for any legacy callers
      summary: {
        totalStaff:       parseInt(staffR.rows[0].count)   || 0,
        activeStrikes:    parseInt(strikesR.rows[0].count) || 0,
        activeLoa:        parseInt(loaR.rows[0].count)     || 0,
        recentPromotions: parseInt(promoR.rows[0].count)   || 0,
        totalShiftMins,
        totalShifts,
      },
      activityBreakdown: activityR.rows,
    });
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── FEATURE 7 (FREEMIUM): Premium Status Check (enhanced) ────────────────
app.get('/api/guilds/:id/premium-features', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ isPremium: false, features: {} });
  try {
    const r = await query('SELECT is_premium, premium_expires_at FROM servers WHERE id=$1', [id]);
    const row = r.rows[0] || {};
    const isPrem = !!row.is_premium && (!row.premium_expires_at || new Date(row.premium_expires_at) > new Date());
    const [ranksR, divsR, blacklistR] = await Promise.all([
      query('SELECT COUNT(*) FROM ranks WHERE guild_id=$1', [id]),
      query('SELECT COUNT(*) FROM divisions WHERE guild_id=$1 AND is_active=TRUE', [id]),
      query('SELECT COUNT(*) FROM blacklist WHERE guild_id=$1 AND active=TRUE', [id]),
    ]);
    res.json({
      isPremium: isPrem,
      expiresAt: row.premium_expires_at || null,
      features: {
        ranks:         { used: parseInt(ranksR.rows[0].count)||0,     limit: isPrem ? null : 5,  unlimited: isPrem },
        divisions:     { used: parseInt(divsR.rows[0].count)||0,      limit: isPrem ? null : 3,  unlimited: isPrem },
        blacklist:     { used: parseInt(blacklistR.rows[0].count)||0, limit: isPrem ? null : 25, unlimited: isPrem },
        botCustomization: { enabled: isPrem },
        strikeAutomation: { enabled: isPrem },
        advancedAnalytics:{ enabled: isPrem },
        performanceReviews:{ enabled: true, limit: isPrem ? null : 3 },
        shiftTracking:    { enabled: true,  limit: isPrem ? null : 50 },
        activityLogs:     { enabled: true,  retentionDays: isPrem ? 90 : 7 },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DB: Migrations for new tables ─────────────────────────────────────────
if (DATABASE_URL) {
  (async () => {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS promotion_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'promotion',
          from_rank TEXT,
          to_rank TEXT NOT NULL,
          reason TEXT,
          promoted_by TEXT,
          promoted_by_name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS shifts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT,
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMP,
          duration_mins NUMERIC,
          shift_type TEXT DEFAULT 'general',
          notes TEXT,
          break_mins NUMERIC DEFAULT 0
        );
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'general';
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS break_mins NUMERIC DEFAULT 0;
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS duration_mins NUMERIC;
        CREATE TABLE IF NOT EXISTS divisions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          discord_role_id TEXT,
          color TEXT DEFAULT '#5865F2',
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS performance_reviews (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guild_id TEXT NOT NULL,
          target_user_id TEXT NOT NULL,
          target_username TEXT,
          reviewer_id TEXT,
          reviewer_username TEXT,
          rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
          comments TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS strike_automation (
          guild_id TEXT PRIMARY KEY,
          enabled BOOLEAN DEFAULT FALSE,
          threshold INTEGER DEFAULT 3,
          action TEXT DEFAULT 'dm_warn',
          dm_message TEXT,
          remove_role_id TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS staff_portal_sessions (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          roblox_verified_at TIMESTAMP,
          PRIMARY KEY (user_id, guild_id)
        );
        ALTER TABLE servers ADD COLUMN IF NOT EXISTS bot_added BOOLEAN DEFAULT FALSE;
        ALTER TABLE servers ADD COLUMN IF NOT EXISTS owner_id TEXT;
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'general';
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE shifts ADD COLUMN IF NOT EXISTS break_mins NUMERIC DEFAULT 0;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS promotion_log_channel_id TEXT;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS commendation_channel_id TEXT;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS shift_cards_channel_id TEXT;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS rank_request_reviewer_role_id TEXT;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS strike_dm_user BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS strike_log_enabled BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS shift_tracking_enabled BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_strikes BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_promotions BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_loa BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_commendations BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_applications BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_staff_changes BOOLEAN DEFAULT TRUE;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS log_shifts BOOLEAN DEFAULT FALSE;
        ALTER TABLE staff_handbook ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS is_embed BOOLEAN DEFAULT FALSE;
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0;
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS embed_title TEXT;
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS embed_color TEXT DEFAULT '#5865F2';
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT '{}';
        ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS requires_role TEXT;
        ALTER TABLE duty_roster ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        ALTER TABLE duty_roster ADD COLUMN IF NOT EXISTS duration_mins NUMERIC DEFAULT 0;
        ALTER TABLE duty_roster ADD COLUMN IF NOT EXISTS duty_type TEXT DEFAULT 'general';
        ALTER TABLE duty_roster ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS embed_color TEXT DEFAULT '#d4af37';
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS embed_footer TEXT DEFAULT 'Zenith Staff Management';
        ALTER TABLE server_config ADD COLUMN IF NOT EXISTS staff_role_ids TEXT[] DEFAULT '{}';
        ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
        ALTER TABLE application_submissions ADD COLUMN IF NOT EXISTS panel_title TEXT;
        ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS last_active TIMESTAMP;
        ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      `);
      console.log('[DB] New feature tables migrated');
    } catch (e) {
      console.log('[DB] Migration note:', e.message);
    }
  })();
}

// ── Premium: enforce rank limit (5 free / unlimited premium) ─────────────
// Patch the existing rank creation to check premium
// (This is handled by overriding ranks POST via middleware)


// ── 22. Admin ─────────────────────────────────────────────────────────────
let globalNotifications = [];

app.post('/api/admin/verify-pin', (req, res) => {
  const { pin, userId } = req.body;
  const ADMIN_ID = '1416209242838401064';
  const ADMIN_PIN = '1232009';
  if (userId !== ADMIN_ID) return res.status(403).json({ error: 'Unauthorized' });
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ success: true, token: Buffer.from(`${userId}:${Date.now()}`).toString('base64') });
});

app.get('/api/admin/notifications', (_req, res) => res.json(globalNotifications.slice(0, 50)));
app.post('/api/admin/send-notification', (req, res) => {
  const { message, type } = req.body;
  globalNotifications.unshift({ id: Date.now(), message, type: type || 'info', timestamp: new Date(), read: false });
  res.json({ success: true });
});

// ── 23. Static Files & Page Routes ────────────────────────────────────────
const publicPath = join(__dirname, 'dist');

  // ── 22. Warnings ──────────────────────────────────────────────────────
  app.get('/api/guilds/:id/warnings', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!DATABASE_URL) return res.json([]);
    try {
      const r = userId
        ? await query(`SELECT * FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [id, userId])
        : await query(`SELECT * FROM warnings WHERE guild_id = $1 ORDER BY created_at DESC`, [id]);
      res.json(r.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/warnings', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { userId, username, reason, severity, issuedBy, issuedByName } = req.body;
    if (!userId || !reason || !issuedBy) return res.status(400).json({ error: 'Missing required fields' });
    if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
    try {
      const r = await query(
        `INSERT INTO warnings (guild_id, user_id, username, reason, severity, issued_by, issued_by_name, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
        [id, userId, username, reason, severity || 'minor', issuedBy, issuedByName]
      );
      // Update warning count on staff member
      await query(
        `UPDATE staff_members SET warnings = (SELECT COUNT(*) FROM warnings WHERE guild_id=$1 AND user_id=$2 AND active=TRUE)
         WHERE guild_id=$1 AND user_id=$2`,
        [id, userId]
      ).catch(() => {});
      // Auto-escalate: 3 major warnings → create a strike
      const majorCount = await query(
        `SELECT COUNT(*) FROM warnings WHERE guild_id=$1 AND user_id=$2 AND severity='major' AND active=TRUE`,
        [id, userId]
      );
      if (parseInt(majorCount.rows[0].count) >= 3) {
        await query(
          `INSERT INTO strikes (guild_id, user_id, username, reason, issued_by, issued_by_name, active, severity)
           VALUES ($1,$2,$3,'Auto-escalated from 3 major warnings',$4,$5,TRUE,'auto') ON CONFLICT DO NOTHING`,
          [id, userId, username, issuedBy, issuedByName]
        ).catch(() => {});
        // Deactivate the warnings so count resets
        await query(`UPDATE warnings SET active=FALSE WHERE guild_id=$1 AND user_id=$2 AND severity='major'`, [id, userId]).catch(() => {});
      }
      await logActivity(id, issuedBy, issuedByName, 'warning_issued', { targetId: userId, reason, severity });
      res.json(r.rows[0]);
    } catch (err) {
      console.error('[warning create]', err);
      res.status(500).json({ error: 'Failed to create warning' });
    }
  });

  // Clear all warnings for a specific Discord user (bot uses this)
  app.delete('/api/guilds/:id/warnings/clear/:userId', requireAuth, async (req, res) => {
    const { id, userId } = req.params;
    try {
      const r = await query(
        `UPDATE warnings SET active=FALSE WHERE guild_id=$1 AND user_id=$2 AND active=TRUE RETURNING id`,
        [id, userId]
      );
      await query(
        `UPDATE staff_members SET warnings = 0 WHERE guild_id=$1 AND user_id=$2`,
        [id, userId]
      ).catch(() => {});
      res.json({ success: true, cleared: r.rowCount });
    } catch (err) {
      res.status(500).json({ error: 'Failed to clear warnings' });
    }
  });

  app.delete('/api/guilds/:id/warnings/:warningId', requireAuth, async (req, res) => {
    const { id, warningId } = req.params;
    try {
      await query(`UPDATE warnings SET active=FALSE WHERE id=$1 AND guild_id=$2`, [warningId, id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove warning' });
    }
  });

  // ── 23. Blacklist ─────────────────────────────────────────────────────
  app.get('/api/guilds/:id/blacklist', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { search, active } = req.query;
    if (!DATABASE_URL) return res.json([]);
    try {
      let sql = `SELECT * FROM blacklist WHERE guild_id=$1`;
      const params = [id];
      if (active === 'true') { sql += ` AND active=TRUE`; }
      else if (active === 'false') { sql += ` AND active=FALSE`; }
      if (search) {
        params.push(`%${search}%`);
        sql += ` AND (username ILIKE $${params.length} OR reason ILIKE $${params.length} OR added_by_name ILIKE $${params.length})`;
      }
      sql += ` ORDER BY created_at DESC LIMIT 200`;
      const r = await query(sql, params);
      res.json(r.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/blacklist', requireBotOrAuth, async (req, res) => {
    const { id } = req.params;
    const { userId, username, reason, addedBy, addedByName, addedById } = req.body;
    const resolvedAddedBy = addedBy || addedById || req.session?.user?.id;
    const resolvedAddedByName = addedByName || req.session?.user?.username || 'Unknown';
    if (!userId || !reason || !resolvedAddedBy) return res.status(400).json({ error: 'userId, reason and addedBy are required' });
    if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
    try {
      const r = await query(
        `INSERT INTO blacklist (guild_id, user_id, username, reason, added_by, added_by_name, active)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING *`,
        [id, userId, username || userId, reason, resolvedAddedBy, resolvedAddedByName]
      );
      await logActivity(id, resolvedAddedBy, resolvedAddedByName, 'blacklist_add', { username: username || userId, reason });
      res.json(r.rows[0]);
    } catch (err) {
      console.error('[blacklist add]', err);
      res.status(500).json({ error: 'Failed to add to blacklist' });
    }
  });

  // Get blacklist entry by Discord user ID (bot uses this for /blacklist check)
  app.get('/api/guilds/:id/blacklist/user/:userId', requireBotOrAuth, async (req, res) => {
    const { id, userId } = req.params;
    if (!DATABASE_URL) return res.status(404).json({ error: 'Not found' });
    try {
      const r = await query(
        `SELECT * FROM blacklist WHERE guild_id=$1 AND user_id=$2 AND active=TRUE ORDER BY created_at DESC LIMIT 1`,
        [id, userId]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Not blacklisted' });
      res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Failed to check blacklist' }); }
  });

  // Remove blacklist entry by Discord user ID (bot uses this for /blacklist remove)
  app.delete('/api/guilds/:id/blacklist/user/:userId', requireBotOrAuth, async (req, res) => {
    const { id, userId } = req.params;
    try {
      await query(`UPDATE blacklist SET active=FALSE WHERE guild_id=$1 AND user_id=$2`, [id, userId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove from blacklist' });
    }
  });

  app.delete('/api/guilds/:id/blacklist/:entryId', requireAuth, async (req, res) => {
    const { id, entryId } = req.params;
    try {
      await query(`UPDATE blacklist SET active=FALSE WHERE id=$1 AND guild_id=$2`, [entryId, id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove from blacklist' });
    }
  });

  // ── 24. Register Discord Slash Commands (fixes duplicates) ────────────
  app.post('/api/admin/register-commands', requireBotSecret, async (req, res) => {
    if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) return res.status(400).json({ error: 'Bot token/client ID not configured' });
    try {
      // First delete all existing global commands to fix duplicates
      const listRes = await fetch(`${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/commands`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });
      const existing = listRes.ok ? await listRes.json() : [];
      if (Array.isArray(existing)) {
        await Promise.all(existing.map(cmd =>
          fetch(`${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/commands/${cmd.id}`, {
            method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
          })
        ));
      }

      // Register fresh command set (staff management only)
      const commands = [
        { name: 'strike', description: 'Issue a strike to a staff member', options: [
            { type: 6, name: 'user', description: 'The staff member to strike', required: true },
            { type: 3, name: 'reason', description: 'Reason for the strike', required: true },
            { type: 3, name: 'severity', description: 'Strike severity', required: false,
              choices: [{ name: 'Strike', value: 'strike' }, { name: 'Final Warning', value: 'final_warning' }] },
          ] },
        { name: 'strikes', description: 'View strikes for a staff member', options: [
            { type: 6, name: 'user', description: 'Staff member to check', required: true },
          ] },
        { name: 'warn', description: 'Issue a warning to a staff member', options: [
            { type: 6, name: 'user', description: 'The staff member to warn', required: true },
            { type: 3, name: 'reason', description: 'Reason for the warning', required: true },
            { type: 3, name: 'severity', description: 'Warning severity', required: false,
              choices: [{ name: 'Minor', value: 'minor' }, { name: 'Moderate', value: 'moderate' }, { name: 'Major', value: 'major' }] },
          ] },
        { name: 'loa', description: 'Request a leave of absence', options: [
            { type: 3, name: 'reason', description: 'Reason for LOA', required: true },
            { type: 3, name: 'start', description: 'Start date (YYYY-MM-DD)', required: true },
            { type: 3, name: 'end', description: 'End date (YYYY-MM-DD)', required: true },
          ] },
        { name: 'staff', description: 'Manage staff roster', options: [
            { type: 1, name: 'add', description: 'Add a staff member', options: [
                { type: 6, name: 'user', description: 'Discord user to add', required: true },
                { type: 3, name: 'rank', description: 'Their rank/role', required: true },
              ] },
            { name: 'remove', type: 1, description: 'Remove a staff member', options: [
                { type: 6, name: 'user', description: 'Discord user to remove', required: true },
                { type: 3, name: 'reason', description: 'Reason for removal', required: false },
              ] },
            { type: 1, name: 'info', description: 'View staff member info', options: [
                { type: 6, name: 'user', description: 'Discord user to look up', required: true },
              ] },
          ] },
        { name: 'stafflist', description: 'List all active staff members' },
        { name: 'blacklist', description: 'Manage the applicant blacklist', options: [
            { type: 1, name: 'add', description: 'Add a user to the blacklist', options: [
                { type: 6, name: 'user', description: 'User to blacklist', required: true },
                { type: 3, name: 'reason', description: 'Reason', required: true },
              ] },
            { type: 1, name: 'check', description: 'Check if a user is blacklisted', options: [
                { type: 6, name: 'user', description: 'User to check', required: true },
              ] },
          ] },
        { name: 'config', description: 'View current server configuration (admins only)' },
      ];

      const regRes = await fetch(`${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/commands`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
      });

      if (!regRes.ok) {
        const err = await regRes.json();
        return res.status(400).json({ error: 'Discord API error', details: err });
      }

      const registered = await regRes.json();
      res.json({ success: true, registered: registered.length, commands: registered.map(c => c.name) });
    } catch (err) {
      console.error('[register-commands]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── 25. Discord Interactions Handler ─────────────────────────────────

  // ── Per-guild stats overview ──────────────────────────────────────────────
  app.get('/api/guilds/:id/stats', requireAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json({ totalStaff: parseInt((await query('SELECT COUNT(*) FROM staff_members WHERE guild_id = $1 AND is_active = TRUE', [id]).catch(()=>({rows:[{count:0}]}))) .rows[0]?.count) || 0, pendingApplications: 0, activeStrikes: 0, activeLoa: 0, recentPromotions: 0, recentHires: 0, avgActivityScore: 0 });
    try {
      const [appsR, strikesR, loaR, actR] = await Promise.all([
        query('SELECT COUNT(*) FROM applications WHERE guild_id = $1 AND status = $2', [id, 'pending']),
        query('SELECT COUNT(*) FROM strikes WHERE guild_id = $1 AND active = true', [id]),
        query("SELECT COUNT(*) FROM loa_requests WHERE guild_id = $1 AND status IN ('approved','active')", [id]),
        query('SELECT COUNT(*) AS avg FROM activity_logs WHERE guild_id = $1', [id]),
      ]);
      res.json({
        totalStaff: parseInt((await query('SELECT COUNT(*) FROM staff_members WHERE guild_id = $1 AND is_active = TRUE', [id]).catch(()=>({rows:[{count:0}]}))) .rows[0]?.count) || 0,
        pendingApplications: parseInt(appsR.rows[0]?.count) || 0,
        activeStrikes: parseInt(strikesR.rows[0]?.count) || 0,
        activeLoa: parseInt(loaR.rows[0]?.count) || 0,
        recentPromotions: 0, recentHires: 0,
        avgActivityScore: Math.round(parseFloat(actR.rows[0]?.avg) || 0),
      });
    } catch { res.json({ totalStaff: parseInt((await query('SELECT COUNT(*) FROM staff_members WHERE guild_id = $1 AND is_active = TRUE', [id]).catch(()=>({rows:[{count:0}]}))) .rows[0]?.count) || 0, pendingApplications: 0, activeStrikes: 0, activeLoa: 0, recentPromotions: 0, recentHires: 0, avgActivityScore: 0 }); }
  });
  
  app.post('/api/interactions', express.raw({ type: '*/*' }), async (req, res) => {
    // ── Discord Ed25519 signature verification ─────────────────────────────
      if (INTERACTIONS_PUBLIC_KEY) {
        const sig = req.headers['x-signature-ed25519'];
        const ts  = req.headers['x-signature-timestamp'];
        if (!sig || !ts) return res.status(401).json({ error: 'Missing signature headers' });
        try {
          const { subtle } = await import('node:crypto');
          const key = await subtle.importKey('raw', Buffer.from(INTERACTIONS_PUBLIC_KEY, 'hex'), { name: 'Ed25519' }, false, ['verify']);
          const valid = await subtle.verify('Ed25519', key, Buffer.from(sig, 'hex'), new TextEncoder().encode(ts + req.body.toString()));
          if (!valid) return res.status(401).json({ error: 'Invalid request signature' });
        } catch { return res.status(401).json({ error: 'Signature verification error' }); }
      }
    let body;
    try { body = JSON.parse(req.body.toString()); } catch { return res.status(400).end(); }

    // Handle PING from Discord
    if (body.type === 1) return res.json({ type: 1 });

    // Application command interactions (slash commands)
    if (body.type === 2) {
      const guildId = body.guild_id;
      const userId = body.member?.user?.id || body.user?.id;
      const username = body.member?.user?.global_name || body.member?.user?.username || 'Unknown';
      const cmdName = body.data?.name;

      const ack = (content, ephemeral = true) => res.json({
        type: 4,
        data: { content, flags: ephemeral ? 64 : 0 },
      });

      if (!guildId) return ack('This command must be used in a server.');

      try {
        if (cmdName === 'strike') {
          const targetId = body.data.options?.find(o => o.name === 'user')?.value;
          const reason = body.data.options?.find(o => o.name === 'reason')?.value;
          const severity = body.data.options?.find(o => o.name === 'severity')?.value || 'strike';
          if (!DATABASE_URL) return ack('Database not configured.');
          const targetMember = body.data.resolved?.members?.[targetId];
          const targetUser = body.data.resolved?.users?.[targetId];
          const targetName = targetUser?.global_name || targetUser?.username || targetId;
          await query(
            `INSERT INTO strikes (guild_id, user_id, username, reason, issued_by, issued_by_name, active, severity)
             VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
            [guildId, targetId, targetName, reason, userId, username, severity]
          );
          await logActivity(guildId, userId, username, 'strike_issued', { targetId, reason, severity });
          return ack(`✅ Strike issued to <@${targetId}> for: **${reason}**`, false);
        }

        if (cmdName === 'warn') {
          const targetId = body.data.options?.find(o => o.name === 'user')?.value;
          const reason = body.data.options?.find(o => o.name === 'reason')?.value;
          const severity = body.data.options?.find(o => o.name === 'severity')?.value || 'minor';
          if (!DATABASE_URL) return ack('Database not configured.');
          const targetUser = body.data.resolved?.users?.[targetId];
          const targetName = targetUser?.global_name || targetUser?.username || targetId;
          await query(
            `INSERT INTO warnings (guild_id, user_id, username, reason, severity, issued_by, issued_by_name, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
            [guildId, targetId, targetName, reason, severity, userId, username]
          );
          return ack(`⚠️ ${severity.charAt(0).toUpperCase() + severity.slice(1)} warning issued to <@${targetId}>: **${reason}**`, false);
        }

        if (cmdName === 'strikes') {
          const targetId = body.data.options?.find(o => o.name === 'user')?.value;
          if (!DATABASE_URL) return ack('Database not configured.');
          const r = await query(`SELECT * FROM strikes WHERE guild_id=$1 AND user_id=$2 AND active=TRUE ORDER BY created_at DESC`, [guildId, targetId]);
          if (r.rows.length === 0) return ack(`<@${targetId}> has no active strikes. ✅`);
          const list = r.rows.map((s, i) => `**${i+1}.** ${s.reason} *(by ${s.issued_by_name || 'Unknown'}, ${new Date(s.created_at).toLocaleDateString()})*`).join('\n');
          return ack(`**Strikes for <@${targetId}>** (${r.rows.length} active):\n${list}`);
        }

        if (cmdName === 'loa') {
          const reason = body.data.options?.find(o => o.name === 'reason')?.value;
          const start = body.data.options?.find(o => o.name === 'start')?.value;
          const end = body.data.options?.find(o => o.name === 'end')?.value;
          if (!DATABASE_URL) return ack('Database not configured.');
          await query(
            `INSERT INTO loa_requests (guild_id, user_id, username, reason, start_date, end_date, status)
             VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
            [guildId, userId, username, reason, new Date(start), new Date(end)]
          );
          return ack(`📅 Your LOA request has been submitted for **${start} → ${end}**. Awaiting management approval.`);
        }

        if (cmdName === 'stafflist') {
          if (!DATABASE_URL) return ack('Database not configured.');
          const r = await query(`SELECT username, rank FROM staff_members WHERE guild_id=$1 AND is_active=TRUE ORDER BY rank, username LIMIT 20`, [guildId]);
          if (r.rows.length === 0) return ack('No active staff members found.');
          const list = r.rows.map(m => `• **${m.username}** — ${m.rank || 'Staff'}`).join('\n');
          return ack(`**Active Staff (${r.rows.length}):**\n${list}`, false);
        }

        if (cmdName === 'staff') {
          const sub = body.data.options?.[0]?.name;
          const subOpts = body.data.options?.[0]?.options || [];
          if (sub === 'add') {
            const targetId = subOpts.find(o => o.name === 'user')?.value;
            const rank = subOpts.find(o => o.name === 'rank')?.value;
            const targetUser = body.data.resolved?.users?.[targetId];
            const targetName = targetUser?.global_name || targetUser?.username || targetId;
            const avatarUrl = targetUser?.avatar ? `https://cdn.discordapp.com/avatars/${targetId}/${targetUser.avatar}.png` : null;
            await query(
              `INSERT INTO staff_members (guild_id, user_id, username, avatar_url, rank, role)
               VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (guild_id, user_id) DO UPDATE SET rank=$5, role=$5, is_active=TRUE, updated_at=NOW()`,
              [guildId, targetId, targetName, avatarUrl, rank]
            );
            return ack(`✅ <@${targetId}> added to staff as **${rank}**.`, false);
          }
          if (sub === 'remove') {
            const targetId = subOpts.find(o => o.name === 'user')?.value;
            await query(`UPDATE staff_members SET is_active=FALSE, updated_at=NOW() WHERE guild_id=$1 AND user_id=$2`, [guildId, targetId]);
            return ack(`✅ <@${targetId}> removed from staff roster.`, false);
          }
          if (sub === 'info') {
            const targetId = subOpts.find(o => o.name === 'user')?.value;
            const [sm, sR] = await Promise.all([
              query(`SELECT * FROM staff_members WHERE guild_id=$1 AND user_id=$2`, [guildId, targetId]),
              query(`SELECT COUNT(*) FROM strikes WHERE guild_id=$1 AND user_id=$2 AND active=TRUE`, [guildId, targetId]),
            ]);
            if (!sm.rows[0]) return ack(`<@${targetId}> is not in the staff roster.`);
            const m = sm.rows[0];
            return ack(`**Staff Info: ${m.username}**\nRank: ${m.rank || 'N/A'}\nDivision: ${m.division || 'N/A'}\nActive Strikes: ${sR.rows[0].count}\nJoined: ${new Date(m.joined_at).toLocaleDateString()}`);
          }
        }

        if (cmdName === 'config') {
          if (!DATABASE_URL) return ack('Database not configured.');
          const r = await query(`SELECT * FROM server_config WHERE guild_id=$1`, [guildId]);
          const cfg = r.rows[0];
          if (!cfg) return ack('No configuration saved yet. Set it up at the Zenith dashboard.');
          return ack(`**Zenith Configuration**\nApplications: ${cfg.applications_enabled ? 'Enabled' : 'Disabled'}\nStrike Threshold: ${cfg.strike_threshold}\nLOA Approval Required: ${cfg.loa_require_approval ? 'Yes' : 'No'}\nPrefix: ${cfg.prefix}\n\nManage at your dashboard.`);
        }

        return ack('Unknown command.');
      } catch (err) {
        console.error('[interactions]', err);
        return ack('An error occurred. Please try again.');
      }
    }

    // Button/component interactions
    if (body.type === 3) {
      const customId = body.data?.custom_id;
      const guildId = body.guild_id;
      const userId = body.member?.user?.id || body.user?.id;
      const username = body.member?.user?.global_name || body.member?.user?.username || 'Unknown';

      if (customId === 'zenith_apply') {
        return res.json({
          type: 9, // MODAL
          data: {
            custom_id: 'apply_modal',
            title: 'Staff Application',
            components: [{
              type: 1, components: [{
                type: 4, custom_id: 'why_apply', label: 'Why do you want to join the staff team?',
                style: 2, min_length: 50, max_length: 1000, required: true,
                placeholder: 'Be specific and honest...',
              }],
            }, {
              type: 1, components: [{
                type: 4, custom_id: 'experience', label: 'What relevant experience do you have?',
                style: 2, min_length: 20, max_length: 500, required: true,
                placeholder: 'Previous server staff, moderation experience, etc.',
              }],
            }, {
              type: 1, components: [{
                type: 4, custom_id: 'age', label: 'How old are you and what timezone are you in?',
                style: 1, max_length: 50, required: true, placeholder: 'e.g. 17, EST',
              }],
            }],
          },
        });
      }

      if (customId === 'zenith_loa') {
        return res.json({
          type: 9, // MODAL
          data: {
            custom_id: 'loa_modal',
            title: 'Leave of Absence Request',
            components: [{
              type: 1, components: [{
                type: 4, custom_id: 'loa_reason', label: 'Reason for Leave of Absence',
                style: 2, min_length: 10, max_length: 500, required: true,
                placeholder: 'Please be specific about why you need time off.',
              }],
            }, {
              type: 1, components: [{
                type: 4, custom_id: 'loa_dates', label: 'Start and End Dates',
                style: 1, required: true, placeholder: 'e.g. May 20 → May 30, 2025',
              }],
            }],
          },
        });
      }

      return res.json({ type: 6 }); // Deferred update for unknown buttons
    }

    // Modal submit interactions
    if (body.type === 5) {
      const customId = body.data?.custom_id;
      const guildId = body.guild_id;
      const userId = body.member?.user?.id || body.user?.id;
      const username = body.member?.user?.global_name || body.member?.user?.username || 'Unknown';

      if (customId === 'apply_modal' && DATABASE_URL) {
        const answers = body.data.components.flatMap(row => row.components).reduce((acc, comp) => {
          acc[comp.custom_id] = comp.value;
          return acc;
        }, {});

        const cfg = await query('SELECT applications_review_channel_id, embed_footer FROM server_config WHERE guild_id=$1', [guildId]).catch(() => ({ rows: [] }));
        const reviewChannel = cfg.rows[0]?.applications_review_channel_id;

        if (reviewChannel && DISCORD_BOT_TOKEN) {
          await fetch(`${DISCORD_API}/channels/${reviewChannel}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '📋 New Staff Application',
                color: 0xd4af37,
                author: { name: username, icon_url: body.member?.user?.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${body.member.user.avatar}.png` : undefined },
                fields: Object.entries(answers).map(([k, v]) => ({ name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value: String(v), inline: false })),
                footer: { text: cfg.rows[0]?.embed_footer || 'Zenith Staff Management' },
                timestamp: new Date().toISOString(),
              }],
              components: [{
                type: 1, components: [
                  { type: 2, style: 3, label: 'Accept', custom_id: `app_accept_${userId}`, emoji: { name: '✅' } },
                  { type: 2, style: 4, label: 'Decline', custom_id: `app_decline_${userId}`, emoji: { name: '❌' } },
                ],
              }],
            }),
          }).catch(() => {});
        }

        return res.json({ type: 4, data: { content: '✅ Your application has been submitted! Management will review it shortly.', flags: 64 } });
      }

      if (customId === 'loa_modal' && DATABASE_URL) {
        const reason = body.data.components[0]?.components[0]?.value;
        const dates = body.data.components[1]?.components[0]?.value;
        const today = new Date();
        const nextWeek = new Date(today.getTime() + 7 * 86400000);

        await query(
          `INSERT INTO loa_requests (guild_id, user_id, username, reason, start_date, end_date, status)
           VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
          [guildId, userId, username, `${reason} (dates: ${dates})`, today, nextWeek]
        ).catch(() => {});

        // Notify review channel
        const cfg = await query('SELECT loa_channel_id, embed_footer FROM server_config WHERE guild_id=$1', [guildId]).catch(() => ({ rows: [] }));
        const loaChannel = cfg.rows[0]?.loa_channel_id;
        if (loaChannel && DISCORD_BOT_TOKEN) {
          await fetch(`${DISCORD_API}/channels/${loaChannel}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '📅 LOA Request',
                color: 0xd4af37,
                description: `**${username}** has submitted a Leave of Absence request.\n\n**Reason:** ${reason}\n**Dates:** ${dates}`,
                footer: { text: cfg.rows[0]?.embed_footer || 'Zenith Staff Management' },
                timestamp: new Date().toISOString(),
              }],
            }),
          }).catch(() => {});
        }

        return res.json({ type: 4, data: { content: '📅 Your LOA request has been submitted and is pending management approval.', flags: 64 } });
      }

      return res.json({ type: 4, data: { content: 'Received!', flags: 64 } });
    }

    res.status(400).json({ error: 'Unknown interaction type' });
  });

  app.use(express.static(publicPath));


// ═══════════════════════════════════════════════════════════════════════════
// ZENITH EXTENDED FEATURES — injected block
// ═══════════════════════════════════════════════════════════════════════════

// ── DB migrations for new tables ──────────────────────────────────────────
(async () => {
  if (!DATABASE_URL) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS staff_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        target_username TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_username TEXT NOT NULL,
        is_private BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS server_announcements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_username TEXT NOT NULL,
        channel_id TEXT,
        mass_dm BOOLEAN DEFAULT FALSE,
        dm_sent INTEGER DEFAULT 0,
        dm_failed INTEGER DEFAULT 0,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE server_announcements ADD COLUMN IF NOT EXISTS mass_dm BOOLEAN DEFAULT FALSE;
      ALTER TABLE server_announcements ADD COLUMN IF NOT EXISTS dm_sent INTEGER DEFAULT 0;
      ALTER TABLE server_announcements ADD COLUMN IF NOT EXISTS dm_failed INTEGER DEFAULT 0;
      CREATE TABLE IF NOT EXISTS duty_roster (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT DEFAULT 'Staff',
        on_duty BOOLEAN DEFAULT TRUE,
        checked_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checked_out_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS commendations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        target_username TEXT NOT NULL,
        given_by_id TEXT NOT NULL,
        given_by_username TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS rank_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        current_rank TEXT,
        requested_rank TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_by_name TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS warning_escalation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL UNIQUE,
        enabled BOOLEAN DEFAULT FALSE,
        warnings_to_strike INTEGER DEFAULT 3,
        reset_after_days INTEGER DEFAULT 30,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS staff_handbook (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        section TEXT DEFAULT 'General',
        sort_order INTEGER DEFAULT 0,
        is_premium BOOLEAN DEFAULT FALSE,
        is_public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS weekly_schedule (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        timezone TEXT DEFAULT 'UTC',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS custom_commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        response TEXT NOT NULL,
        embed_title TEXT,
        embed_color TEXT DEFAULT '#5865F2',
        requires_role TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS staff_goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        target_value NUMERIC,
        current_value NUMERIC DEFAULT 0,
        unit TEXT DEFAULT '',
        due_date DATE,
        status TEXT DEFAULT 'active',
        user_id TEXT,
        username TEXT,
        created_by TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS inactivity_scans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        last_activity TIMESTAMP,
        days_inactive INTEGER,
        status TEXT DEFAULT 'flagged',
        dismissed_at TIMESTAMP,
        scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS auto_promotion_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        from_rank TEXT NOT NULL,
        to_rank TEXT NOT NULL,
        min_shift_hours INTEGER DEFAULT 0,
        min_days_at_rank INTEGER DEFAULT 0,
        require_no_strikes BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS embed_configs (
        guild_id TEXT PRIMARY KEY,
        color TEXT DEFAULT '#d4af37',
        footer TEXT DEFAULT 'Zenith Staff Management',
        thumbnail_url TEXT,
        show_timestamp BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS training_programs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        category TEXT DEFAULT 'general',
        required BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS training_completions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        program_id UUID REFERENCES training_programs(id) ON DELETE SET NULL,
        program_name TEXT,
        username TEXT NOT NULL,
        user_id TEXT,
        completed_by_name TEXT,
        score NUMERIC,
        notes TEXT,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS incident_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'medium',
        involved_staff TEXT DEFAULT '',
        location TEXT,
        reported_by TEXT,
        reported_by_name TEXT,
        status TEXT DEFAULT 'open',
        resolution TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS application_panels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        questions JSONB DEFAULT '[]',
        button_label TEXT DEFAULT 'Apply Now',
        review_role_ids TEXT[] DEFAULT '{}',
        review_channel_id TEXT DEFAULT '',
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS application_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id TEXT NOT NULL,
        panel_id UUID REFERENCES application_panels(id) ON DELETE CASCADE,
        panel_title TEXT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        answers JSONB DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        reviewer_id TEXT,
        reviewer_username TEXT,
        reviewer_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DB] Extended tables migrated');
  } catch (err) {
    console.error('[DB] Extended migration error:', err.message);
  }
})();

// ── Image Upload (base64 inline, no external deps) ────────────────────────
app.post('/api/upload/image', requireAuth, (req, res) => {
  const { base64, filename } = req.body;
  if (!base64) return res.status(400).json({ error: 'No image data' });
  const maxSize = 2 * 1024 * 1024; // 2MB base64 limit
  if (base64.length > maxSize) return res.status(400).json({ error: 'Image too large (max 2MB)' });
  // Just return the base64 data URI directly — stored in DB as-is
  const mimeMatch = base64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
  res.json({ url: base64, success: true });
});

// ── Staff Notes ───────────────────────────────────────────────────────────
app.get('/api/guilds/:id/notes', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      userId
        ? `SELECT * FROM staff_notes WHERE guild_id = $1 AND target_user_id = $2 ORDER BY created_at DESC`
        : `SELECT * FROM staff_notes WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 100`,
      userId ? [id, userId] : [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/notes', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { targetUserId, targetUsername, content, authorId, authorUsername, isPrivate } = req.body;
  if (!content?.trim() || !targetUserId) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const r = await query(
      `INSERT INTO staff_notes (guild_id, target_user_id, target_username, content, author_id, author_username, is_private)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, targetUserId, targetUsername, content.trim(), authorId, authorUsername, !!isPrivate]
    );
    await logActivity(id, authorId, authorUsername, 'note_added', { target: targetUsername });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guilds/:id/notes/:noteId', requireAuth, async (req, res) => {
  const { id, noteId } = req.params;
  try {
    await query(`DELETE FROM staff_notes WHERE id = $1 AND guild_id = $2`, [noteId, id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete note' }); }
});

// ── Announcements ─────────────────────────────────────────────────────────
app.get('/api/guilds/:id/announcements', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM server_announcements WHERE guild_id = $1 ORDER BY sent_at DESC LIMIT 50`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/announcements', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, content, channelId, authorId, authorUsername, sendToDiscord } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Title and content required' });
  try {
    const r = await query(
      `INSERT INTO server_announcements (guild_id, title, content, author_id, author_username, channel_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, title.trim(), content.trim(), authorId, authorUsername, channelId || null]
    );
    // Optionally post to Discord channel
    if (sendToDiscord && channelId && process.env.DISCORD_BOT_TOKEN) {
      try {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: `📢 ${title}`,
              description: content,
              color: 0xD4AF37,
              footer: { text: `Announced by ${authorUsername}` },
              timestamp: new Date().toISOString(),
            }]
          }),
        });
      } catch {}
    }
    await logActivity(id, authorId, authorUsername, 'announcement', { title });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Duty Roster ───────────────────────────────────────────────────────────
app.get('/api/guilds/:id/roster', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT id, user_id, username, avatar_url, role, duty_type, notes, on_duty, checked_in_at, checked_out_at, duration_mins
       FROM duty_roster WHERE guild_id = $1 AND on_duty = TRUE ORDER BY checked_in_at DESC`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.get('/api/guilds/:id/roster/history', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT id, user_id, username, avatar_url, role, duty_type, notes, on_duty, checked_in_at, checked_out_at, duration_mins
       FROM duty_roster WHERE guild_id = $1 ORDER BY checked_in_at DESC LIMIT 200`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/roster/checkin', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, role, dutyType, avatarUrl, notes } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    // End any existing open duty
    await query(
      `UPDATE duty_roster SET on_duty = FALSE, checked_out_at = NOW(),
         duration_mins = EXTRACT(EPOCH FROM (NOW() - checked_in_at)) / 60
       WHERE guild_id = $1 AND user_id = $2 AND on_duty = TRUE`,
      [id, userId]
    ).catch(() => {});
    // Lookup avatar from staff_members if not provided
    let finalAvatar = avatarUrl || null;
    if (!finalAvatar) {
      const smR = await query(`SELECT avatar_url FROM staff_members WHERE guild_id=$1 AND user_id=$2`, [id, userId]).catch(() => ({ rows: [] }));
      finalAvatar = smR.rows[0]?.avatar_url || null;
    }
    const r = await query(
      `INSERT INTO duty_roster (guild_id, user_id, username, role, duty_type, avatar_url, notes, on_duty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
      [id, userId, username, role || 'Staff', dutyType || 'general', finalAvatar, notes || null]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guilds/:id/roster/checkout', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    await query(
      `UPDATE duty_roster SET on_duty = FALSE, checked_out_at = NOW(),
         duration_mins = EXTRACT(EPOCH FROM (NOW() - checked_in_at)) / 60
       WHERE guild_id = $1 AND user_id = $2 AND on_duty = TRUE`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Commendations ─────────────────────────────────────────────────────────
app.get('/api/guilds/:id/commendations', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM commendations WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 100`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.get('/api/guilds/:id/commendations/leaderboard', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(
      `SELECT target_user_id, target_username, COUNT(*) as count FROM commendations WHERE guild_id = $1 GROUP BY target_user_id, target_username ORDER BY count DESC LIMIT 10`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/commendations', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  // Support both naming conventions: bot uses issuedById, dashboard uses givenById
  const targetUserId = req.body.targetUserId;
  const targetUsername = req.body.targetUsername;
  const givenById = req.body.givenById || req.body.issuedById || req.session?.user?.id;
  const givenByUsername = req.body.givenByUsername || req.body.issuedByUsername || req.session?.user?.username;
  const reason = req.body.reason || req.body.description;
  if (!reason?.trim() || !targetUserId) return res.status(400).json({ error: 'Missing fields' });
  try {
    const r = await query(
      `INSERT INTO commendations (guild_id, target_user_id, target_username, given_by_id, given_by_username, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, targetUserId, targetUsername, givenById, givenByUsername, reason.trim()]
    );
    await logActivity(id, givenById, givenByUsername, 'commendation', { target: targetUsername, reason: reason.trim() });
    // Optionally notify via Discord
    if (process.env.DISCORD_BOT_TOKEN) {
      try {
        const cfgR = await query(`SELECT logs_channel_id FROM server_config WHERE guild_id = $1`, [id]);
        const ch = cfgR.rows[0]?.logs_channel_id;
        if (ch) {
          await fetch(`https://discord.com/api/v10/channels/${ch}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [{ title: '🌟 Commendation Issued', description: `**${targetUsername}** received a commendation from **${givenByUsername}**\n\n${reason}`, color: 0xFFD700, timestamp: new Date().toISOString() }] }),
          });
        }
      } catch {}
    }
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Rank Requests ─────────────────────────────────────────────────────────
app.get('/api/guilds/:id/rank-requests', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM rank_requests WHERE guild_id = $1 ORDER BY created_at DESC`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/rank-requests', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, currentRank, requestedRank, reason } = req.body;
  if (!requestedRank || !reason?.trim()) return res.status(400).json({ error: 'Missing fields' });
  try {
    // Only 1 pending request per user
    const existing = await query(`SELECT id FROM rank_requests WHERE guild_id = $1 AND user_id = $2 AND status = 'pending'`, [id, userId]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'You already have a pending rank request' });
    const r = await query(
      `INSERT INTO rank_requests (guild_id, user_id, username, current_rank, requested_rank, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, userId, username, currentRank || null, requestedRank, reason.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/guilds/:id/rank-requests/:reqId', requireAuth, async (req, res) => {
  const { id, reqId } = req.params;
  const { status, reviewedBy, reviewedByName } = req.body;
  if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const r = await query(
      `UPDATE rank_requests SET status = $1, reviewed_by = $2, reviewed_by_name = $3, reviewed_at = NOW() WHERE id = $4 AND guild_id = $5 RETURNING *`,
      [status, reviewedBy, reviewedByName, reqId, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Warning Escalation Config ─────────────────────────────────────────────
app.get('/api/guilds/:id/warning-escalation', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ enabled: false, warnings_to_strike: 3, reset_after_days: 30 });
  try {
    const r = await query(`SELECT * FROM warning_escalation WHERE guild_id = $1`, [id]);
    res.json(r.rows[0] || { enabled: false, warnings_to_strike: 3, reset_after_days: 30 });
  } catch { res.json({ enabled: false, warnings_to_strike: 3, reset_after_days: 30 }); }
});

app.post('/api/guilds/:id/warning-escalation', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { enabled, warningsToStrike, resetAfterDays } = req.body;
  try {
    const r = await query(
      `INSERT INTO warning_escalation (guild_id, enabled, warnings_to_strike, reset_after_days)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (guild_id) DO UPDATE SET enabled = $2, warnings_to_strike = $3, reset_after_days = $4, updated_at = NOW()
       RETURNING *`,
      [id, !!enabled, warningsToStrike || 3, resetAfterDays || 30]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Staff Handbook ────────────────────────────────────────────────────────
app.get('/api/guilds/:id/handbook', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    // Alias section→category and sort_order→order_index so frontend field names match
    const r = await query(
      `SELECT id, title, content, section, section AS category, sort_order, sort_order AS order_index,
              is_public, is_premium, created_at, updated_at
       FROM staff_handbook WHERE guild_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

// Bot-accessible handbook endpoint (used by z!handbook and /handbook commands)
app.get('/api/guilds/:id/handbook/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT id, title, content, section, sort_order, is_public FROM staff_handbook WHERE guild_id = $1 ORDER BY sort_order ASC, created_at ASC`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/handbook', requireAuth, async (req, res) => {
  const { id } = req.params;
  // Support both field naming conventions: frontend uses category/isPublic, bot uses section/sortOrder
  const title = req.body.title;
  const content = req.body.content;
  const section = req.body.section || req.body.category || 'General';
  const sortOrder = req.body.sortOrder || req.body.order_index || 0;
  const isPublic = req.body.isPublic !== undefined ? req.body.isPublic : true;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Title and content required' });
  try {
    const r = await query(
      `INSERT INTO staff_handbook (guild_id, title, content, section, sort_order, is_public)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, title.trim(), content.trim(), section, sortOrder, isPublic]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Also accept PUT for handbook (frontend uses PUT when editing)
app.put('/api/guilds/:id/handbook/:entryId', requireAuth, async (req, res) => {
  const { id, entryId } = req.params;
  const title = req.body.title;
  const content = req.body.content;
  const section = req.body.section || req.body.category || null;
  const sortOrder = req.body.sortOrder || req.body.order_index || null;
  const isPublic = req.body.isPublic !== undefined ? req.body.isPublic : null;
  try {
    const r = await query(
      `UPDATE staff_handbook SET title=COALESCE($1,title), content=COALESCE($2,content), section=COALESCE($3,section),
       sort_order=COALESCE($4,sort_order), is_public=COALESCE($5,is_public), updated_at=NOW()
       WHERE id=$6 AND guild_id=$7 RETURNING *`,
      [title||null, content||null, section, sortOrder, isPublic, entryId, id]
    );
    res.json(r.rows[0] || { error: 'Not found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/guilds/:id/handbook/:entryId', requireAuth, async (req, res) => {
  const { id, entryId } = req.params;
  const title = req.body.title;
  const content = req.body.content;
  const section = req.body.section || req.body.category || null;
  const sortOrder = req.body.sortOrder || req.body.order_index || null;
  const isPublic = req.body.isPublic !== undefined ? req.body.isPublic : null;
  try {
    const r = await query(
      `UPDATE staff_handbook SET title=COALESCE($1,title), content=COALESCE($2,content), section=COALESCE($3,section),
       sort_order=COALESCE($4,sort_order), is_public=COALESCE($5,is_public), updated_at=NOW()
       WHERE id=$6 AND guild_id=$7 RETURNING *`,
      [title||null, content||null, section, sortOrder, isPublic, entryId, id]
    );
    res.json(r.rows[0] || { error: 'Not found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guilds/:id/handbook/:entryId', requireAuth, async (req, res) => {
  const { id, entryId } = req.params;
  try {
    await query(`DELETE FROM staff_handbook WHERE id = $1 AND guild_id = $2`, [entryId, id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── Weekly Schedule ───────────────────────────────────────────────────────
app.get('/api/guilds/:id/schedule', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM weekly_schedule WHERE guild_id = $1 ORDER BY day_of_week, start_time`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/schedule', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username, dayOfWeek, startTime, endTime, timezone } = req.body;
  try {
    const r = await query(
      `INSERT INTO weekly_schedule (guild_id, user_id, username, day_of_week, start_time, end_time, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, userId, username, dayOfWeek, startTime, endTime, timezone || 'UTC']
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guilds/:id/schedule/:slotId', requireAuth, async (req, res) => {
  const { id, slotId } = req.params;
  try {
    await query(`DELETE FROM weekly_schedule WHERE id = $1 AND guild_id = $2`, [slotId, id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── Custom Commands (Premium) ─────────────────────────────────────────────
app.get('/api/guilds/:id/custom-commands', requireBotOrAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM custom_commands WHERE guild_id = $1 ORDER BY name`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/custom-commands', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, description, response, embedTitle, embedColor, requiresRole, isEmbed } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  if (!name?.trim() || !response?.trim()) return res.status(400).json({ error: 'Name and response required' });
  try {
    const pR = await query(`SELECT is_premium FROM servers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
    const isPrem = !!pR.rows[0]?.is_premium;
    if (!isPrem) {
      const cnt = await query(`SELECT COUNT(*) FROM custom_commands WHERE guild_id=$1 AND is_active=TRUE`, [id]);
      if (parseInt(cnt.rows[0]?.count || '0') >= 5) {
        return res.status(403).json({ error: 'Free tier: max 5 custom commands. Upgrade to Premium for unlimited.' });
      }
    }
    const safeName = name.trim().toLowerCase().replace(/^\//,'').replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
    const r = await query(
      `INSERT INTO custom_commands (guild_id, name, description, response, embed_title, embed_color, is_embed, requires_role, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
       ON CONFLICT (guild_id, name) DO UPDATE SET description=$3, response=$4, embed_title=$5, embed_color=$6, is_embed=$7, requires_role=$8, is_active=TRUE
       RETURNING *`,
      [id, safeName, description || '', response.trim(), embedTitle || null, embedColor || '#5865F2', !!isEmbed, requiresRole || null]
    );
    // Auto-register as guild slash command in Discord
    const ccRow = r.rows[0];
    if (DISCORD_BOT_TOKEN && process.env.DISCORD_APPLICATION_ID && ccRow) {
      fetch(`${DISCORD_API}/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${id}/commands`, {
        method: 'POST',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ccRow.name, description: (ccRow.description || 'Custom command').slice(0, 100), type: 1 }),
      }).catch(() => {});
    }
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/guilds/:id/custom-commands/:cmdId', requireAuth, async (req, res) => {
  const { id, cmdId } = req.params;
  const { isActive, name, description, response, embedTitle, embedColor, isEmbed, requiresRole } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    // Toggle active or full update
    if (typeof isActive === 'boolean') {
      const r = await query(
        `UPDATE custom_commands SET is_active=$1 WHERE id=$2 AND guild_id=$3 RETURNING *`,
        [isActive, cmdId, id]
      );
      return res.json(r.rows[0] || { ok: true });
    }
    // Full update
    const r = await query(
      `UPDATE custom_commands SET
         name=COALESCE($1,name), description=COALESCE($2,description), response=COALESCE($3,response),
         embed_title=$4, embed_color=COALESCE($5,embed_color), is_embed=COALESCE($6,is_embed),
         requires_role=$7
       WHERE id=$8 AND guild_id=$9 RETURNING *`,
      [name||null, description||null, response||null, embedTitle||null, embedColor||null, typeof isEmbed==='boolean'?isEmbed:null, requiresRole||null, cmdId, id]
    );
    res.json(r.rows[0] || { ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guilds/:id/custom-commands/:cmdId', requireAuth, async (req, res) => {
  const { id, cmdId } = req.params;
  try {
    await query(`DELETE FROM custom_commands WHERE id = $1 AND guild_id = $2`, [cmdId, id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

  // Increment custom command use count (called by bot after execution)
  app.post('/api/guilds/:id/custom-commands/:cmdId/use', requireBotOrAuth, async (req, res) => {
    const { id, cmdId } = req.params;
    if (!DATABASE_URL) return res.json({ ok: true });
    try {
      await query(
        `UPDATE custom_commands SET use_count = COALESCE(use_count, 0) + 1 WHERE id = $1 AND guild_id = $2`,
        [cmdId, id]
      );
      res.json({ ok: true });
    } catch { res.json({ ok: true }); }
  });
  

// Fetch custom commands for bot runtime — is_active filter + use_count support
app.get('/api/guilds/:id/custom-commands/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM custom_commands WHERE guild_id=$1 AND is_active=TRUE ORDER BY name`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

// ── Inactivity Scanner (Free + Premium) ───────────────────────────────────
app.get('/api/guilds/:id/inactivity', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    // Free plan: show inactivity data (read-only); Premium: can run scans + auto-DM
    const r = await query(
      `SELECT s.user_id, s.username, s.rank,
         GREATEST(MAX(a.created_at), MAX(sh.started_at)) as last_activity,
         EXTRACT(EPOCH FROM (NOW() - GREATEST(MAX(a.created_at), MAX(sh.started_at)))) / 86400 as days_inactive
       FROM staff_members s
       LEFT JOIN activity_logs a ON a.guild_id = s.guild_id AND a.user_id = s.user_id
       LEFT JOIN shifts sh ON sh.guild_id = s.guild_id AND sh.user_id = s.user_id
       WHERE s.guild_id = $1 AND s.is_active = TRUE
       GROUP BY s.user_id, s.username, s.rank
       ORDER BY days_inactive DESC NULLS FIRST`,
      [id]
    );
    res.json(r.rows.map(row => ({
      id: row.user_id,
      user_id: row.user_id,
      username: row.username,
      rank: row.rank,
      last_activity: row.last_activity,
      days_inactive: row.days_inactive ? Math.round(parseFloat(row.days_inactive)) : null,
      status: (row.days_inactive === null || parseFloat(row.days_inactive) > 7) ? 'flagged' : 'active',
      scanned_at: new Date().toISOString(),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guilds/:id/inactivity/scan', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { thresholdDays = 7 } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const r = await query(
      `SELECT s.user_id, s.username,
         GREATEST(MAX(a.created_at), MAX(sh.started_at)) as last_activity,
         EXTRACT(EPOCH FROM (NOW() - GREATEST(MAX(a.created_at), MAX(sh.started_at)))) / 86400 as days_inactive
       FROM staff_members s
       LEFT JOIN activity_logs a ON a.guild_id = s.guild_id AND a.user_id = s.user_id
       LEFT JOIN shifts sh ON sh.guild_id = s.guild_id AND sh.user_id = s.user_id
       WHERE s.guild_id = $1 AND s.is_active = TRUE
       GROUP BY s.user_id, s.username
       HAVING EXTRACT(EPOCH FROM (NOW() - GREATEST(MAX(a.created_at), MAX(sh.started_at)))) / 86400 > $2
          OR GREATEST(MAX(a.created_at), MAX(sh.started_at)) IS NULL`,
      [id, thresholdDays]
    );
    res.json({ flagged: r.rows.length, members: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guilds/:id/inactivity/:userId/dismiss', requireAuth, async (req, res) => {
  // Just a soft acknowledgement — no DB row needed since we compute dynamically
  res.json({ ok: true });
});

// ── Mass DM (Premium) ─────────────────────────────────────────────────────
// Alias so frontend can call /announcements/mass-dm
  app.post('/api/guilds/:id/announcements/mass-dm', requireAuth, async (req, res) => {
    req.url = req.url.replace('/announcements/mass-dm', '/mass-dm');
    const { id } = req.params;
    const { message, title, authorId, authorUsername } = req.body;
    if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
    try {
      const pR = await query(`SELECT is_premium FROM servers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
      if (!pR.rows[0]?.is_premium) return res.status(403).json({ error: 'Premium required' });
      if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
      const staffR = await query(`SELECT user_id FROM staff_members WHERE guild_id = $1 AND is_active = TRUE`, [id]);
      let sent = 0, failed = 0;
      if (process.env.DISCORD_BOT_TOKEN) {
        for (const s of staffR.rows) {
          try {
            const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
              method: 'POST',
              headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipient_id: s.user_id }),
            });
            if (dmRes.ok) {
              const dm = await dmRes.json();
              await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
                method: 'POST',
                headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [{ title: title || '📢 Staff Announcement', description: message, color: 0xD4AF37, footer: { text: `From ${authorUsername}` }, timestamp: new Date().toISOString() }] }),
              });
              sent++;
            } else { failed++; }
            await new Promise(r => setTimeout(r, 200));
          } catch { failed++; }
        }
      } else { sent = -1; }
      // Log to announcements table
      await query(
        `INSERT INTO server_announcements (guild_id, title, content, author_id, author_username, mass_dm, dm_sent, dm_failed) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7) ON CONFLICT DO NOTHING`,
        [id, title || 'Mass DM', message, authorId, authorUsername, sent, failed]
      ).catch(() => query(
        `INSERT INTO server_announcements (guild_id, title, content, author_id, author_username) VALUES ($1,$2,$3,$4,$5)`,
        [id, title || 'Mass DM', message, authorId, authorUsername]
      ).catch(() => {}));
      await logActivity(id, authorId, authorUsername, 'mass_dm', { message: message.slice(0, 100), sent, failed });
      res.json({ success: true, sent, failed, total: staffR.rows.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/guilds/:id/mass-dm', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { message, title, authorId, authorUsername } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  try {
    const pR = await query(`SELECT is_premium FROM servers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
    if (!pR.rows[0]?.is_premium) return res.status(403).json({ error: 'Premium required' });
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    // Get all active staff Discord IDs
    const staffR = await query(`SELECT user_id FROM staff_members WHERE guild_id = $1 AND is_active = TRUE`, [id]);
    let sent = 0, failed = 0;
    if (process.env.DISCORD_BOT_TOKEN) {
      for (const s of staffR.rows) {
        try {
          const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
            method: 'POST',
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id: s.user_id }),
          });
          if (dmRes.ok) {
            const dm = await dmRes.json();
            await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
              method: 'POST',
              headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ embeds: [{ title: title || '📢 Staff Announcement', description: message, color: 0xD4AF37, footer: { text: `From ${authorUsername}` }, timestamp: new Date().toISOString() }] }),
            });
            sent++;
          } else { failed++; }
          await new Promise(r => setTimeout(r, 200)); // rate limit
        } catch { failed++; }
      }
    } else { sent = -1; } // bot not configured
    await logActivity(id, authorId, authorUsername, 'mass_dm', { message: message.slice(0, 100), sent, failed });
    res.json({ success: true, sent, failed, total: staffR.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-Promotion Rules (Premium) ────────────────────────────────────────
app.get('/api/guilds/:id/auto-promo-rules', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`SELECT * FROM auto_promotion_rules WHERE guild_id = $1 ORDER BY from_rank`, [id]);
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post('/api/guilds/:id/auto-promo-rules', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { fromRank, toRank, minShiftHours, minDaysAtRank, requireNoStrikes } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  const pR = await query(`SELECT is_premium FROM servers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  if (!pR.rows[0]?.is_premium) return res.status(403).json({ error: 'Premium required' });
  try {
    const r = await query(
      `INSERT INTO auto_promotion_rules (guild_id, from_rank, to_rank, min_shift_hours, min_days_at_rank, require_no_strikes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, fromRank, toRank, minShiftHours || 0, minDaysAtRank || 0, requireNoStrikes !== false]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guilds/:id/auto-promo-rules/:ruleId', requireAuth, async (req, res) => {
  const { id, ruleId } = req.params;
  try {
    await query(`DELETE FROM auto_promotion_rules WHERE id = $1 AND guild_id = $2`, [ruleId, id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── Embed Config (per-server) ─────────────────────────────────────────────
app.get('/api/guilds/:id/embed-config', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ color: '#d4af37', footer: 'Zenith Staff Management', show_timestamp: true });
  try {
    const r = await query(`SELECT * FROM embed_configs WHERE guild_id = $1`, [id]);
    res.json(r.rows[0] || { color: '#d4af37', footer: 'Zenith Staff Management', show_timestamp: true });
  } catch { res.json({ color: '#d4af37', footer: 'Zenith Staff Management', show_timestamp: true }); }
});

app.post('/api/guilds/:id/embed-config', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { color, footer, thumbnailUrl, showTimestamp } = req.body;
  try {
    const r = await query(
      `INSERT INTO embed_configs (guild_id, color, footer, thumbnail_url, show_timestamp)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (guild_id) DO UPDATE SET color=$2, footer=$3, thumbnail_url=$4, show_timestamp=$5, updated_at=NOW()
       RETURNING *`,
      [id, color || '#d4af37', footer || 'Zenith Staff Management', thumbnailUrl || null, showTimestamp !== false]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bot fetches embed config for all its embeds
app.get('/api/guilds/:id/embed-config/bot', requireBotSecret, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ color: '#d4af37', footer: 'Zenith Staff Management', show_timestamp: true });
  try {
    const cfgR = await query(`SELECT embed_color, embed_footer FROM server_config WHERE guild_id = $1`, [id]);
    const embedR = await query(`SELECT * FROM embed_configs WHERE guild_id = $1`, [id]);
    const cfg = cfgR.rows[0] || {};
    const embed = embedR.rows[0] || {};
    res.json({
      color: embed.color || cfg.embed_color || '#d4af37',
      footer: embed.footer || cfg.embed_footer || 'Zenith Staff Management',
      thumbnailUrl: embed.thumbnail_url || null,
      showTimestamp: embed.show_timestamp !== false,
    });
  } catch { res.json({ color: '#d4af37', footer: 'Zenith Staff Management', show_timestamp: true }); }
});

// ── Changelog / Status ────────────────────────────────────────────────────
const CHANGELOG = [
  { version: '2.5.0', date: '2026-05-20', type: 'fix', changes: ['Fixed TypeScript syntax crash (const params: any[] on line 2311)', 'Fixed shifts start/end endpoints to accept bot-secret auth', 'Fixed custom command use tracking endpoint auth', 'Fixed mass-DM INSERT using non-existent DB columns', 'Fixed DB migration: shifts now always have shift_type/notes/duration_mins columns', 'Fixed DB migration: server_announcements now has mass_dm/dm_sent/dm_failed columns', 'Rank-request POST now accepts bot-secret (enables /requestrank Discord command)', 'Notes POST now accepts bot-secret (enables /note from bot)', 'Performance review POST now accepts bot-secret'] },
  { version: '2.4.0', date: '2026-05-19', type: 'feature', changes: ['Fixed critical server startup crash (db.js migrations)', 'Fixed inactivity scanner table name bug (activity_logs)', 'Added auto-strike escalation when warning threshold is reached', 'Added mass-DM endpoint alias for announcements page', 'Bot now registers custom commands as guild slash commands', 'Bot customization now applies changes to Discord via REST', 'Rank limit enforced: free=5, premium=unlimited', 'Division limit enforced: free=5, premium=50', 'Announcements dialog crash fixed (empty Select value)', 'Added /commend and /note Discord commands', 'Custom command use count tracking'] },
    { version: '2.3.0', date: '2026-05-18', type: 'feature', changes: ['Added Duty Roster — check in/out of active duty', 'Added Staff Handbook — configurable docs for your server', 'Added Commendations — recognize outstanding staff', 'Added Rank Requests — staff can request promotions via dashboard', 'Added Weekly Schedule planner', 'Added Strike Automation config page (Premium)', 'Added Advanced Analytics with 7-day trends (Premium)', 'Added Custom Commands builder (Premium)', 'Added Inactivity Scanner (Premium)', 'Added Mass DM to all staff (Premium)'] },
  { version: '2.2.0', date: '2026-05-17', type: 'feature', changes: ['Promotions & Demotion history page', 'Shift tracking with live timer', 'Divisions system with Discord role sync', 'Performance reviews with leaderboard', 'Analytics dashboard', 'Auth fix: bot commands now work without BOT_SECRET on web service'] },
  { version: '2.1.0', date: '2026-05-15', type: 'fix', changes: ['Fixed 403/401 bot command errors', 'Premium grant now works end-to-end', 'Improved embed colors', 'Added /analytics, /schedule, /performance, /divisions commands'] },
  { version: '2.0.0', date: '2026-05-10', type: 'major', changes: ['Complete rewrite — Express 5 backend', 'New React dashboard with Vite', 'Discord OAuth2 authentication', 'Full strike, LOA, application, warning systems', 'Real-time Discord bot integration'] },
];

app.get('/api/changelog', (_req, res) => res.json(CHANGELOG));

app.get('/api/status', async (_req, res) => {
  const status = { api: 'operational', database: 'unknown', bot: 'unknown', timestamp: new Date().toISOString() };
  if (DATABASE_URL) {
    try { await query('SELECT 1'); status.database = 'operational'; } catch { status.database = 'degraded'; }
  } else { status.database = 'not_configured'; }
  res.json(status);
});

// ── Bot Customization (extended — embed settings + image upload) ───────────
app.post('/api/guilds/:id/bot-customization/image', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { base64, type } = req.body; // type: 'avatar' | 'thumbnail'
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
  const pR = await query(`SELECT is_premium FROM servers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  if (!pR.rows[0]?.is_premium) return res.status(403).json({ error: 'Premium required' });
  if (!base64) return res.status(400).json({ error: 'No image data' });
  if (base64.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 2MB)' });
  try {
    const col = type === 'thumbnail' ? 'custom_bot_thumbnail' : 'custom_bot_avatar';
    // Add column if not exists
    await query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS ${col} TEXT`).catch(() => {});
    await query(`UPDATE servers SET ${col} = $1 WHERE id = $2`, [base64, id]);
    res.json({ success: true, url: base64 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Extended bot customization GET (includes all settings)
app.get('/api/guilds/:id/bot-customization/extended', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ isPremium: false });
  try {
    const [sR, cfgR] = await Promise.all([
      query(`SELECT is_premium, custom_bot_name, custom_bot_avatar, custom_bot_status FROM servers WHERE id = $1`, [id]),
      query(`SELECT embed_color, embed_footer FROM server_config WHERE guild_id = $1`, [id]),
    ]);
    const row = sR.rows[0] || {};
    const cfg = cfgR.rows[0] || {};
    res.json({
      isPremium: !!row.is_premium,
      customBotName: row.custom_bot_name || '',
      customBotAvatar: row.custom_bot_avatar || '',
      customBotStatus: row.custom_bot_status || '',
      embedColor: cfg.embed_color || '#d4af37',
      embedFooter: cfg.embed_footer || 'Zenith Staff Management',
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});


const pages = [
  ['/select-server', 'select-server.html'], ['/staff-portal', 'staff-portal.html'],
  ['/staff-dashboard', 'staff-dashboard.html'], ['/admin-portal', 'admin-portal.html'],
  ['/dashboard', 'dashboard.html'], ['/status', 'status.html'],
  ['/premium', 'premium.html'], ['/settings', 'settings.html'],
  ['/server-settings', 'settings-config.html'], ['/settings-config', 'settings-config.html'],
  ['/staff-roster', 'staff-roster.html'], ['/audit-logs', 'audit-logs.html'],
  ['/applications-config', 'applications-config.html'], ['/circle-config', 'circle-config.html'],
  ['/privacy', 'privacy.html'], ['/tos', 'tos.html'],
  ['/profile/:username', 'profile.html'],
];

for (const [route, file] of pages) {
  app.get(route, (_req, res) => res.sendFile(join(publicPath, file)));
}

// Catch-all → index.html
app.get('*', (_req, res) => res.sendFile(join(publicPath, 'index.html')));

// ── 24. Start ────────────────────────────────────────────────────────────

  // ─── Application Panels ───────────────────────────────────────────────────
  app.get('/api/guilds/:id/application-panels', requireAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json([]);
    try {
      const panels = await query('SELECT * FROM application_panels WHERE guild_id=$1 ORDER BY created_at', [id]);
      const panelsWithCounts = await Promise.all(panels.rows.map(async p => {
        const cnt = await query('SELECT COUNT(*) FROM application_submissions WHERE panel_id=$1', [p.id]).catch(() => ({ rows: [{ count: '0' }] }));
        return { ...p, submission_count: parseInt(cnt.rows[0]?.count || '0') };
      }));
      res.json(panelsWithCounts);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/application-panels', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, buttonLabel, questions, reviewRoleIds, reviewChannelId, enabled } = req.body;
    if (!DATABASE_URL || !title) return res.status(400).json({ error: 'Title required' });
    try {
      const r = await query(
        'INSERT INTO application_panels (guild_id, title, description, button_label, questions, review_role_ids, review_channel_id, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [id, title, description || '', buttonLabel || 'Apply Now', JSON.stringify(questions || []), reviewRoleIds || [], reviewChannelId || null, enabled !== false]
      );
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/guilds/:id/application-panels/:panelId', requireAuth, async (req, res) => {
    const { id, panelId } = req.params;
    const { title, description, buttonLabel, questions, reviewRoleIds, reviewChannelId, enabled } = req.body;
    try {
      const r = await query(
        'UPDATE application_panels SET title=$1, description=$2, button_label=$3, questions=$4, review_role_ids=$5, review_channel_id=$6, enabled=$7 WHERE id=$8 AND guild_id=$9 RETURNING *',
        [title, description || '', buttonLabel || 'Apply Now', JSON.stringify(questions || []), reviewRoleIds || [], reviewChannelId || null, enabled !== false, panelId, id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Panel not found' });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/guilds/:id/application-panels/:panelId', requireAuth, async (req, res) => {
    const { id, panelId } = req.params;
    try { await query('DELETE FROM application_panels WHERE id=$1 AND guild_id=$2', [panelId, id]); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Application Submissions ──────────────────────────────────────────────
  app.get('/api/guilds/:id/applications', requireAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json([]);
    try {
      const r = await query('SELECT * FROM application_submissions WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 200', [id]);
      res.json(r.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/applications/:subId/review', requireAuth, async (req, res) => {
    const { id, subId } = req.params;
    const { status, reviewerNotes, reviewerId, reviewerUsername } = req.body;
    if (!['accepted','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
      const r = await query(
        'UPDATE application_submissions SET status=$1, reviewer_notes=$2, reviewer_id=$3, reviewer_username=$4, reviewed_at=NOW() WHERE id=$5 AND guild_id=$6 RETURNING *',
        [status, reviewerNotes || '', reviewerId || req.session?.user?.id || null, reviewerUsername || req.session?.user?.username || null, subId, id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Submission not found' });
      const sub = r.rows[0];
      await logActivity(id, req.session?.user?.id, req.session?.user?.username, 'application_' + status, { submissionId: subId, applicant: sub.username }).catch(() => {});

      // DM the applicant with their result
      if (DISCORD_BOT_TOKEN && sub.user_id) {
        (async () => {
          try {
            const cfgR = await query(`SELECT embed_color, embed_footer FROM server_config WHERE guild_id=$1`, [id]).catch(() => ({ rows: [] }));
            const embedColor = status === 'accepted' ? 0x57F287 : 0xED4245;
            const embedFooter = cfgR.rows[0]?.embed_footer || 'Zenith Staff Management';
            const title = status === 'accepted' ? '✅ Application Accepted' : '❌ Application Rejected';
            const desc = status === 'accepted'
              ? `Your application for **${sub.panel_title || 'Staff Position'}** has been **accepted**! Congratulations!`
              : `Your application for **${sub.panel_title || 'Staff Position'}** has been **rejected**.`;
            const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
              method: 'POST',
              headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipient_id: sub.user_id }),
            });
            if (dmRes.ok) {
              const dm = await dmRes.json();
              await fetch(`${DISCORD_API}/channels/${dm.id}/messages`, {
                method: 'POST',
                headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  embeds: [{
                    color: embedColor,
                    title,
                    description: desc,
                    fields: [
                      ...(reviewerNotes ? [{ name: 'Reviewer Notes', value: reviewerNotes, inline: false }] : []),
                      { name: 'Reviewed By', value: reviewerUsername || req.session?.user?.username || 'Management', inline: true },
                    ],
                    footer: { text: embedFooter },
                    timestamp: new Date().toISOString(),
                  }],
                }),
              }).catch(() => {});
            }
          } catch { /* DMs may be disabled */ }
        })();
      }

      res.json(sub);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Training ─────────────────────────────────────────────────────────────
  app.get('/api/guilds/:id/training/programs', requireBotOrAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json([]);
    try {
      const p = await query('SELECT tp.*, (SELECT COUNT(*) FROM training_completions WHERE program_id=tp.id) as completion_count FROM training_programs tp WHERE tp.guild_id=$1 ORDER BY tp.name', [id]);
      res.json(p.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/training/programs', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { name, description, category, required } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    try {
      const r = await query('INSERT INTO training_programs (guild_id, name, description, category, required) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, name, description || '', category || 'general', !!required]);
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/guilds/:id/training/programs/:progId', requireAuth, async (req, res) => {
    const { id, progId } = req.params;
    try { await query('DELETE FROM training_programs WHERE id=$1 AND guild_id=$2', [progId, id]); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/guilds/:id/training/completions', requireAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json([]);
    try {
      const r = await query('SELECT * FROM training_completions WHERE guild_id=$1 ORDER BY completed_at DESC LIMIT 200', [id]);
      res.json(r.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/training/completions', requireBotOrAuth, async (req, res) => {
    const { id } = req.params;
    const { programId, programName, userId, username, score, notes, completedByName, trainerId, trainerName } = req.body;
    // Bot sends programName (not programId), so we look up by name if programId missing
    const resolvedTrainer = trainerId || completedByName || req.session?.user?.id;
    const resolvedTrainerName = trainerName || completedByName || req.session?.user?.username || 'Unknown';
    if (!username) return res.status(400).json({ error: 'username required' });
    try {
      let resolvedProgramId = programId;
      let progName = programName || 'Unknown';
      if (!resolvedProgramId && programName) {
        const pRow = await query('SELECT id, name FROM training_programs WHERE guild_id=$1 AND LOWER(name)=LOWER($2)', [id, programName]);
        if (pRow.rows.length) { resolvedProgramId = pRow.rows[0].id; progName = pRow.rows[0].name; }
      } else if (resolvedProgramId) {
        const prog = await query('SELECT name FROM training_programs WHERE id=$1', [resolvedProgramId]);
        progName = prog.rows[0]?.name || programName || 'Unknown';
      }
      if (!resolvedProgramId) return res.status(400).json({ error: 'Training program not found. Please provide a valid programId or programName.' });
      const r = await query(
        'INSERT INTO training_completions (guild_id, program_id, program_name, user_id, username, completed_by_name, score, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *' ,
        [id, resolvedProgramId, progName, userId || null, username, resolvedTrainerName, score ? parseFloat(score) : null, notes || null]
      );
      await logActivity(id, resolvedTrainer, resolvedTrainerName, 'training_complete', { username, program: progName });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Incident Reports ─────────────────────────────────────────────────────
  app.get('/api/guilds/:id/incidents', requireBotOrAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json([]);
    try {
      const r = await query('SELECT * FROM incident_reports WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 200', [id]);
      res.json(r.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/incidents', requireBotOrAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, severity, involvedStaff, location, reportedByName, reportedById } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required.' });
    try {
      const r = await query(
        'INSERT INTO incident_reports (guild_id, title, description, severity, involved_staff, location, reported_by_name, reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [id, title.trim(), description.trim(), severity || 'medium', involvedStaff || '', location || '', reportedByName || req.session?.user?.username || '', req.session?.user?.id || '']
      );
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/guilds/:id/incidents/:incidentId', requireAuth, async (req, res) => {
    const { id, incidentId } = req.params;
    const { status, resolution } = req.body;
    try {
      const r = await query(
        'UPDATE incident_reports SET status=COALESCE($1,status), resolution=COALESCE($2,resolution) WHERE id=$3 AND guild_id=$4 RETURNING *',
        [status || null, resolution || null, incidentId, id]
      );
      res.json(r.rows[0] || { ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/guilds/:id/incidents/:incidentId', requireAuth, async (req, res) => {
    const { id, incidentId } = req.params;
    try {
      await query('DELETE FROM incident_reports WHERE id=$1 AND guild_id=$2', [incidentId, id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Staff Goals ──────────────────────────────────────────────────────────
  app.get('/api/guilds/:id/goals', requireBotOrAuth, async (req, res) => {
    const { id } = req.params;
    if (!DATABASE_URL) return res.json([]);
    try {
      const r = await query('SELECT * FROM staff_goals WHERE guild_id=$1 ORDER BY created_at DESC', [id]);
      res.json(r.rows);
    } catch { res.json([]); }
  });

  app.post('/api/guilds/:id/goals', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, targetValue, unit, dueDate, username, createdByName } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    try {
      const r = await query(
        'INSERT INTO staff_goals (guild_id, title, description, target_value, unit, due_date, username, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [id, title, description || '', targetValue || null, unit || '', dueDate || null, username || null, req.session?.user?.id || '', createdByName || req.session?.user?.username || '']
      );
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/guilds/:id/goals/:goalId', requireAuth, async (req, res) => {
    const { id, goalId } = req.params;
    const { currentValue } = req.body;
    try {
      const r = await query("UPDATE staff_goals SET current_value=$1, status=CASE WHEN $1::float >= COALESCE(target_value,0) AND target_value IS NOT NULL THEN 'completed' ELSE status END WHERE id=$2 AND guild_id=$3 RETURNING *", [currentValue, goalId, id]);
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/guilds/:id/goals/:goalId', requireAuth, async (req, res) => {
    const { id, goalId } = req.params;
    try { await query('DELETE FROM staff_goals WHERE id=$1 AND guild_id=$2', [goalId, id]); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Fix Performance POST ─────────────────────────────────────────────────
  app.post('/api/guilds/:id/performance', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { targetUserId, targetUsername, rating, strengths, improvements, notes, period, reviewerUsername, reviewerId, isPublic } = req.body;
    if (!targetUserId || !targetUsername || !rating) return res.status(400).json({ error: 'targetUserId, targetUsername, and rating required' });
    try {
      const rId = reviewerId || req.session?.user?.id || 'unknown';
      const rName = reviewerUsername || req.session?.user?.username || 'Unknown';
      const r = await query(
        'INSERT INTO performance_reviews (guild_id, target_user_id, target_username, reviewer_id, reviewer_username, rating, strengths, improvements, notes, period, is_public) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
        [id, targetUserId, targetUsername, rId, rName, parseInt(rating), strengths || '', improvements || '', notes || '', period || '', isPublic !== false]
      );
      await logActivity(id, rId, rName, 'performance_review', { target: targetUsername, rating }).catch(() => {});
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });


  // ─── Shift Send Cards ─────────────────────────────────────────────────────
  app.post('/api/guilds/:id/shifts/send-cards', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { period, channelId, sendDm } = req.body;
    if (!DATABASE_URL) return res.status(400).json({ error: 'No database' });
    const pR = await query('SELECT is_premium FROM servers WHERE id=$1', [id]).catch(() => ({ rows: [] }));
    const isPrem = !!pR.rows[0]?.is_premium;
    if (!isPrem && !sendDm) return res.status(403).json({ error: 'Premium required for channel shift cards' });
    try {
      let interval = '1 day';
      if (period === 'yesterday') interval = '2 days';
      else if (period === 'week') interval = '7 days';
      else if (period === 'month') interval = '30 days';
      const r = await query(
        'SELECT user_id, username, SUM(duration_mins) as total_mins, COUNT(*) as shifts, MIN(started_at) as first_shift, MAX(ended_at) as last_shift FROM shifts WHERE guild_id=$1 AND ended_at IS NOT NULL AND started_at > NOW() - $2::interval GROUP BY user_id, username',
        [id, interval]
      );
      await logActivity(id, req.session?.user?.id, req.session?.user?.username, 'shift_cards_sent', { count: r.rows.length, period }).catch(() => {});
      res.json({ ok: true, count: r.rows.length, period });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  

// ─── Embed Sender ────────────────────────────────────────────────────────────
app.post('/api/guilds/:id/embed-sender/send', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { channelId, title, description, color, footer, authorName, imageUrl, thumbnailUrl, fields } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  if (!title && !description) return res.status(400).json({ error: 'Embed must have at least a title or description' });
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return res.status(500).json({ error: 'Bot token not configured on server' });

  const embed = {};
  if (title) embed.title = title;
  if (description) embed.description = description;
  if (color) embed.color = parseInt(color.replace('#',''), 16);
  if (footer) embed.footer = { text: footer };
  if (authorName) embed.author = { name: authorName };
  if (imageUrl) embed.image = { url: imageUrl };
  if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
  if (Array.isArray(fields) && fields.length > 0) embed.fields = fields.map(f => ({ name: f.name || '​', value: f.value || '​', inline: !!f.inline }));
  embed.timestamp = new Date().toISOString();

  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(400).json({ error: body.message || 'Discord API error', code: body.code });
    await logActivity(id, req.session?.user?.id, req.session?.user?.username, 'embed_sent', { channelId, title: title || '(no title)' }).catch(() => {});
    res.json({ ok: true, messageId: body.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Bot refresh-commands trigger ────────────────────────────────────────────
app.post('/api/guilds/:id/custom-commands/refresh', requireBotOrAuth, async (req, res) => {
  res.json({ ok: true, message: 'Custom command refresh is handled automatically by the bot on startup.' });
});

// ─── Applications Config ─────────────────────────────────────────────────────
app.get('/api/guilds/:id/applications-config', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ enabled: false, channel: '', title: 'Staff Application Form', questions: [] });
  try {
    await query(`CREATE TABLE IF NOT EXISTS application_config (guild_id TEXT PRIMARY KEY, enabled BOOLEAN DEFAULT false, channel TEXT DEFAULT '', title TEXT DEFAULT 'Staff Application Form', questions JSONB DEFAULT '[]', require_recommendations BOOLEAN DEFAULT false, auto_reject BOOLEAN DEFAULT false)`).catch(() => {});
    const r = await query('SELECT * FROM application_config WHERE guild_id=$1', [id]);
    if (!r.rows.length) return res.json({ enabled: false, channel: '', title: 'Staff Application Form', questions: [] });
    const row = r.rows[0];
    res.json({ enabled: !!row.enabled, channel: row.channel || '', title: row.title || 'Staff Application Form', questions: Array.isArray(row.questions) ? row.questions : [], requireRecommendations: !!row.require_recommendations, autoReject: !!row.auto_reject });
  } catch (err) { res.json({ enabled: false, channel: '', title: '', questions: [] }); }
});

app.post('/api/guilds/:id/applications-config', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { enabled, channel, title, questions, requireRecommendations, autoReject } = req.body;
  if (!DATABASE_URL) return res.status(400).json({ error: 'No database configured' });
  try {
    await query(`CREATE TABLE IF NOT EXISTS application_config (guild_id TEXT PRIMARY KEY, enabled BOOLEAN DEFAULT false, channel TEXT DEFAULT '', title TEXT DEFAULT 'Staff Application Form', questions JSONB DEFAULT '[]', require_recommendations BOOLEAN DEFAULT false, auto_reject BOOLEAN DEFAULT false)`).catch(() => {});
    await query(`INSERT INTO application_config (guild_id,enabled,channel,title,questions,require_recommendations,auto_reject) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (guild_id) DO UPDATE SET enabled=$2,channel=$3,title=$4,questions=$5,require_recommendations=$6,auto_reject=$7`, [id, !!enabled, channel || '', title || 'Staff Application Form', JSON.stringify(questions || []), !!requireRecommendations, !!autoReject]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Staff Inactivity ─────────────────────────────────────────────────────────
app.get('/api/guilds/:id/staff/inactive', requireAuth, async (req, res) => {
  const { id } = req.params;
  const days = parseInt(req.query.days || '7');
  if (!DATABASE_URL) return res.json([]);
  try {
    const r = await query(`
      SELECT sm.user_id, sm.username, sm.display_name, sm.highest_role,
        MAX(sh.ended_at) as last_shift,
        MAX(al.created_at) as last_audit
      FROM staff_members sm
      LEFT JOIN shifts sh ON sh.guild_id=$1 AND sh.user_id=sm.user_id
      LEFT JOIN activity_logs al ON al.guild_id=$1 AND al.user_id=sm.user_id
      WHERE sm.guild_id=$1
      GROUP BY sm.user_id, sm.username, sm.display_name, sm.highest_role
      HAVING MAX(sh.ended_at) < NOW() - $2::interval OR MAX(sh.ended_at) IS NULL
      ORDER BY last_shift ASC NULLS FIRST
    `, [id, `${days} days`]);
    res.json(r.rows.map(row => ({ ...row, last_active: row.last_audit || row.last_shift })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guilds/:id/staff/inactivity-scan', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ ok: true, total: 0, flagged: 0, notified: 0 });
  try {
    const r = await query('SELECT COUNT(*) as total FROM staff_members WHERE guild_id=$1', [id]);
    const flagR = await query(`SELECT COUNT(*) as flagged FROM staff_members sm WHERE sm.guild_id=$1 AND NOT EXISTS (SELECT 1 FROM shifts sh WHERE sh.guild_id=$1 AND sh.user_id=sm.user_id AND sh.ended_at > NOW() - INTERVAL '7 days')`, [id]);
    await logActivity(id, 'system', 'System', 'inactivity_scan', { total: r.rows[0]?.total, flagged: flagR.rows[0]?.flagged }).catch(() => {});
    res.json({ ok: true, total: parseInt(r.rows[0]?.total || 0), flagged: parseInt(flagR.rows[0]?.flagged || 0), notified: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guilds/:id/staff/inactivity-warn', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { userId, username } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return res.status(500).json({ error: 'Bot token not configured' });
  try {
    const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, { method: 'POST', headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient_id: userId }) });
    const dm = await dmRes.json();
    if (!dm.id) return res.status(400).json({ error: 'Could not open DM with user' });
    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: '⚠️ Inactivity Notice', description: `Hello ${username || 'there'},\n\nThis is a notice that you have not been recently active as a staff member. Please log your next shift soon or reach out to management if you need a leave of absence.`, color: 0xf0883e, footer: { text: 'Zenith Staff Management' }, timestamp: new Date().toISOString() }] }) });
    await logActivity(id, req.session?.user?.id, req.session?.user?.username, 'inactivity_warn', { target: username, userId }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── XP Leaderboard System ────────────────────────────────────────────────────
app.get('/api/guilds/:id/xp/leaderboard', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json([]);
  try {
    await query(`CREATE TABLE IF NOT EXISTS staff_xp (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, shift_xp INT DEFAULT 0, commendation_xp INT DEFAULT 0, training_xp INT DEFAULT 0, total_xp INT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(guild_id,user_id))`).catch(() => {});
    const r = await query('SELECT * FROM staff_xp WHERE guild_id=$1 ORDER BY total_xp DESC LIMIT 50', [id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guilds/:id/xp/recalculate', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!DATABASE_URL) return res.json({ ok: true, updated: 0 });
  try {
    await query(`CREATE TABLE IF NOT EXISTS staff_xp (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, shift_xp INT DEFAULT 0, commendation_xp INT DEFAULT 0, training_xp INT DEFAULT 0, total_xp INT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(guild_id,user_id))`).catch(() => {});
    const staffR = await query('SELECT DISTINCT user_id, username FROM staff_members WHERE guild_id=$1', [id]).catch(() => ({ rows: [] }));
    let updated = 0;
    for (const m of staffR.rows) {
      const shiftR = await query(`SELECT COALESCE(SUM(LEAST(duration_mins,600)),0) as total_mins FROM shifts WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NOT NULL`, [id, m.user_id]).catch(() => ({ rows: [{ total_mins: 0 }] }));
      const commR = await query('SELECT COUNT(*) as cnt FROM commendations WHERE guild_id=$1 AND target_user_id=$2', [id, m.user_id]).catch(() => ({ rows: [{ cnt: 0 }] }));
      const trainR = await query('SELECT COUNT(*) as cnt FROM training_logs WHERE guild_id=$1 AND trainee_id=$2', [id, m.user_id]).catch(() => ({ rows: [{ cnt: 0 }] }));
      const shiftXP = Math.floor((shiftR.rows[0]?.total_mins || 0) / 10) * 5;
      const commXP = parseInt(commR.rows[0]?.cnt || 0) * 50;
      const trainXP = parseInt(trainR.rows[0]?.cnt || 0) * 30;
      const totalXP = shiftXP + commXP + trainXP;
      await query(`INSERT INTO staff_xp (guild_id,user_id,username,shift_xp,commendation_xp,training_xp,total_xp,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (guild_id,user_id) DO UPDATE SET username=$3,shift_xp=$4,commendation_xp=$5,training_xp=$6,total_xp=$7,updated_at=NOW()`, [id, m.user_id, m.username, shiftXP, commXP, trainXP, totalXP]).catch(() => {});
      updated++;
    }
    res.json({ ok: true, updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Prefix Config (per-guild) ────────────────────────────────────────────────
app.patch('/api/guilds/:id/config/prefix', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { prefix } = req.body;
  if (!prefix || typeof prefix !== 'string') return res.status(400).json({ error: 'prefix required (string)' });
  const clean = prefix.trim().slice(0, 8);
  if (!clean) return res.status(400).json({ error: 'prefix cannot be empty' });
  if (!DATABASE_URL) return res.json({ ok: true, prefix: clean, note: 'No DB; restart bot to apply' });
  try {
    await query(`INSERT INTO servers (id, prefix) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET prefix=$2`, [id, clean]);
    res.json({ ok: true, prefix: clean });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Zenith] Server running on port ${PORT}`);
});

