const API = 'https://discord.com/api/v10';

export class DiscordRestError extends Error {
  constructor(status) {
    super(`Discord request failed (${status}). Check the bot permissions and configuration.`);
    this.status = status;
  }
}

export function createDiscordRest({ token = '', fetchImpl = fetch, timeout = 8000 } = {}) {
  return {
    async request(method, path, body, { webhook = false } = {}) {
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('..')) throw new Error('Invalid Discord API path');
      if (!webhook && !token) throw new Error('Set DISCORD_BOT_TOKEN before publishing panels.');
      const multipart = body instanceof FormData;
      const response = await fetchImpl(`${API}${path}`, {
        method, redirect:'error', signal:AbortSignal.timeout(timeout),
        // fetch sets multipart/form-data with its own matching boundary.
        headers:{ ...(!webhook ? { Authorization:`Bot ${token}` } : {}), ...(body !== undefined && !multipart ? { 'Content-Type':'application/json' } : {}) },
        ...(body !== undefined ? { body:multipart ? body : JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new DiscordRestError(response.status);
      if (response.status === 204) return null;
      return response.json();
    },
  };
}
