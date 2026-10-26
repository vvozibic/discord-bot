const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{15,22}$/;
const AVATAR = /^(a_)?[a-f0-9]{32}$/;

function avatarUrl(user, guildId, member) {
  if (guildId && AVATAR.test(member?.avatar)) return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=64`;
  if (AVATAR.test(user.avatar)) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  const index = user.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function createDiscordAuth({ clientId, clientSecret, allowedGuildId = '', allowedRoleIds = [], fetchImpl = fetch }) {
  async function request(url, options) {
    const response = await fetchImpl(url, { ...options, redirect:'error', signal:AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Discord could not verify the connection. Please try again.');
    return response.json();
  }
  return async ({ code, guildId }) => {
    if (typeof code !== 'string' || code.length < 4 || code.length > 2048 || (guildId != null && !SNOWFLAKE.test(guildId))) throw new Error('Invalid Discord connection');
    if (allowedGuildId && guildId !== allowedGuildId) throw new Error('Launch Forest Trail in the Mindo AI server.');
    const token = await request(`${API}/oauth2/token`, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({ client_id:clientId, client_secret:clientSecret, grant_type:'authorization_code', code }) });
    if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error('Invalid Discord token');
    const headers = { Authorization:`Bearer ${token.access_token}` };
    const authorization = await request(`${API}/oauth2/@me`, { headers });
    if (authorization.application?.id !== clientId || !authorization.scopes?.includes('identify')
      || (guildId && !authorization.scopes.includes('guilds.members.read'))) throw new Error('Discord permissions are incomplete');
    const user = await request(`${API}/users/@me`, { headers });
    if (!SNOWFLAKE.test(user.id) || typeof user.username !== 'string') throw new Error('Invalid Discord profile');
    const member = guildId ? await request(`${API}/users/@me/guilds/${guildId}/member`, { headers }) : null;
    if (member?.user?.id && member.user.id !== user.id) throw new Error('Discord server membership could not be verified');
    if (allowedRoleIds.length && (!Array.isArray(member?.roles) || !member.roles.some(id => allowedRoleIds.includes(id))))
      throw new Error('The beta-tester role is required to play this beta.');
    return { accessToken:token.access_token, expiresIn:Math.min(token.expires_in, 3600),
      profile:{ id:user.id, name:String(member?.nick || user.global_name || user.username).slice(0, 80), avatar:avatarUrl(user, guildId, member) } };
  };
}
