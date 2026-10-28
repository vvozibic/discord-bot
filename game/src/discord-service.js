// Discord Embedded App SDK OrientationLockState enum values.
const ORIENTATION_LOCKS = Object.freeze({ unlocked:1, portrait:2, landscape:3 });
const CONNECTION_MESSAGES = {
  authorizing:'Finish the Discord authorization window to connect your profile. If no window appears, reload the Activity.',
  verifying:'Checking your Discord profile and server access.',
  authenticating:'Waiting for Discord to confirm your profile.',
};

async function withTimeout(operation, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timeout); }
}

export function createDiscordService({ fetchImpl = fetch, onChange = () => {} } = {}) {
  let sdk = null, clientId = '', config = null, session = null, busy = false;
  let connectionStage = '', connectionError = '';
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
    get mobile() { return sdk?.platform === 'mobile'; },
    get busy() { return busy; },
    get connectionStage() { return connectionStage; },
    get connectionMessage() { return CONNECTION_MESSAGES[connectionStage] ?? ''; },
    get connectionError() { return connectionError; },
    get profile() { return session ? { ...session.profile } : null; },
    get boardName() { return session?.boardName ?? config?.eventName ?? 'TAG campaign'; },
    async setOrientation(orientation) {
      if (!['landscape', 'portrait'].includes(orientation)) throw new Error('Unknown screen orientation.');
      if (sdk?.platform !== 'mobile') throw new Error('Rotate your phone to change the view.');
      return withTimeout(() => sdk.commands.setOrientationLockState({
        lock_state:ORIENTATION_LOCKS[orientation],
        picture_in_picture_lock_state:ORIENTATION_LOCKS.unlocked, grid_lock_state:ORIENTATION_LOCKS.unlocked,
      }), 5000, 'The view could not switch. Rotate your phone and try again.');
    },
    async connect() {
      if (busy) return;
      if (!sdk) throw new Error('Open Forest Trail inside Discord to connect your profile.');
      if (!config?.configured) throw new Error('Discord profile connections are not available: server setup is incomplete. Please contact an administrator.');
      busy = true; connectionError = ''; connectionStage = 'authorizing'; emit();
      let authorized;
      try {
        // SDK commands have no built-in deadline. A dropped native-client reply
        // must not keep every Connect button disabled indefinitely.
        const { code } = await withTimeout(() => sdk.commands.authorize({ client_id:clientId, response_type:'code', prompt:'none', state:crypto.randomUUID(),
          scope:sdk.guildId ? ['identify','guilds.members.read'] : ['identify'] }), 60000,
          'Discord authorization did not respond. Tap Connect profile to try again, or reload the Activity.');
        connectionStage = 'verifying'; emit();
        authorized = await request('/discord/session', { method:'POST', token:null, body:{ code, guildId:sdk.guildId ?? null } });
        connectionStage = 'authenticating'; emit();
        const authentication = await withTimeout(() => sdk.commands.authenticate({ access_token:authorized.accessToken }), 15000,
          'Discord did not confirm your profile. Tap Connect profile to try again, or reload the Activity.');
        if (authentication?.user?.id !== authorized.profile.id) throw new Error('Discord could not confirm your profile. Please try again.');
        const { accessToken:discarded, ...applicationSession } = authorized;
        session = applicationSession;
      } catch (error) {
        // Revoke only this failed attempt's token, without delaying recovery on
        // another network request. A late SDK reply cannot resume a timed-out await.
        if (authorized?.token) void request('/discord/session', { method:'DELETE', token:authorized.token }).catch(() => {});
        connectionError = error.message || 'Profile connection was cancelled. You can try again.';
        throw new Error(connectionError);
      } finally { busy = false; connectionStage = ''; emit(); }
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
