export function createDiscordService({ fetchImpl = fetch, onChange = () => {} } = {}) {
  let sdk = null, clientId = '', config = null, session = null, busy = false;
  const listeners = new Set([onChange]);
  function emit() { for (const listener of listeners) listener(); }
  async function request(path, { method = 'GET', body, token = session?.token } = {}) {
    let response;
    try {
      response = await fetchImpl(`/api${path}`, { method, cache:'no-store', signal:AbortSignal.timeout(20000),
        headers:{ ...(body ? { 'Content-Type':'application/json' } : {}), ...(token ? { Authorization:`Bearer ${token}` } : {}) },
        ...(body ? { body:JSON.stringify(body) } : {}) });
    } catch { throw new Error('The server could not be reached. Please try again.'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('The server is unavailable. Please try again.'); }
    if (!response.ok) {
      if (response.status === 401 && token === session?.token) { session = null; emit(); }
      const error = new Error(result.error || 'The request failed. Please try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  return {
    subscribe(listener) { listeners.add(listener); listener(); return () => listeners.delete(listener); },
    async initialize() { try { config = await request('/config'); } catch { config = { configured:false }; } emit(); },
    setSdk(value, id) { sdk = value; clientId = id; emit(); },
    get connected() { return Boolean(session); },
    get ready() { return Boolean(sdk && config?.configured); },
    get configured() { return Boolean(config?.configured); },
    get insideDiscord() { return Boolean(sdk); },
    get busy() { return busy; },
    get profile() { return session ? { ...session.profile } : null; },
    get boardName() { return session?.boardName ?? config?.eventName ?? 'TAG campaign'; },
    async connect() {
      if (busy) return;
      if (!sdk) throw new Error('Open Forest Trail inside Discord to connect your profile.');
      if (!config?.configured) throw new Error('Discord profile connections are not available yet. You can keep playing locally.');
      busy = true; emit();
      let authorized;
      try {
        const { code } = await sdk.commands.authorize({ client_id:clientId, response_type:'code', prompt:'none', state:crypto.randomUUID(),
          scope:sdk.guildId ? ['identify','guilds.members.read'] : ['identify'] });
        authorized = await request('/discord/session', { method:'POST', token:null, body:{ code, guildId:sdk.guildId ?? null } });
        const authentication = await sdk.commands.authenticate({ access_token:authorized.accessToken });
        if (authentication?.user?.id !== authorized.profile.id) throw new Error('Discord could not confirm your profile. Please try again.');
        const { accessToken:discarded, ...applicationSession } = authorized;
        session = applicationSession;
      } catch (error) {
        if (authorized?.token) await request('/discord/session', { method:'DELETE', token:authorized.token }).catch(() => {});
        throw new Error(error.message || 'Profile connection was cancelled. You can try again.');
      } finally { busy = false; emit(); }
    },
    async disconnect() {
      if (session) await request('/discord/session', { method:'DELETE' }).catch(() => {});
      session = null; emit();
    },
    startRun(restart = false) {
      if (!session) throw new Error('Reconnect your Discord profile to continue.');
      return request('/runs', { method:'POST', body:{ restart } });
    },
    finishRun(ticket, trace) {
      if (!session) throw new Error('Reconnect your Discord profile to save this run.');
      return request('/runs/finish', { method:'POST', body:{ ticket, trace } });
    },
    leaderboard() {
      if (!session) throw new Error('Connect your Discord profile to see the shared ranking.');
      return request('/leaderboard');
    },
  };
}

export function discordAvatarUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'cdn.discordapp.com' ? url.href : ''; }
  catch { return ''; }
}
