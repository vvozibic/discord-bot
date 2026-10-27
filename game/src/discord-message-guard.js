export const DISCORD_RPC_ORIGINS = Object.freeze([
  'https://discord.com', 'https://discordapp.com',
  'https://ptb.discord.com', 'https://ptb.discordapp.com',
  'https://canary.discord.com', 'https://canary.discordapp.com',
  'https://staging.discord.co', 'https://pax.discord.com', 'null',
]);

/** Bound work before the SDK schema validator can accumulate per-item errors. */
export function boundedDiscordPayload(value) {
  const pending = [{ value, depth:0 }];
  let nodes = 0, characters = 0;
  while (pending.length) {
    const { value:item, depth } = pending.pop();
    if (++nodes > 4096 || depth > 24) return false;
    if (typeof item === 'string') {
      characters += item.length;
      if (item.length > 65536 || characters > 262144) return false;
    } else if (item && typeof item === 'object') {
      if (Array.isArray(item)) {
        if (item.length > 1024) return false;
        for (const child of item) pending.push({ value:child, depth:depth + 1 });
      } else {
        const prototype = Object.getPrototypeOf(item);
        if (prototype !== Object.prototype && prototype !== null) return false;
        let keys = 0;
        for (const key in item) if (Object.hasOwn(item, key)) {
          characters += key.length;
          if (++keys > 256 || characters > 262144) return false;
          pending.push({ value:item[key], depth:depth + 1 });
        }
      }
      if (pending.length > 4096) return false;
    } else if (item !== null && !['number','boolean','undefined'].includes(typeof item)) return false;
  }
  return true;
}

export function protectDiscordMessages(target, source, origins = DISCORD_RPC_ORIGINS) {
  const allowed = new Set(origins);
  // The native Discord shell forwards RPC using this document's own origin,
  // which the SDK also permits. Trust only that exact origin and parent.
  try {
    const ownOrigin = new URL(target.location?.origin);
    if (['https:', 'http:'].includes(ownOrigin.protocol)) allowed.add(ownOrigin.origin);
  } catch { /* Non-browser targets may not have a document origin. */ }
  const guard = event => {
    if (event.source !== source || !allowed.has(event.origin) || !boundedDiscordPayload(event.data))
      event.stopImmediatePropagation();
  };
  target.addEventListener('message', guard, true);
  return () => target.removeEventListener('message', guard, true);
}
