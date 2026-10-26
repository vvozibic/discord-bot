export const RECORDS_KEY = 'forest-trail-records-v1';
const MODES = new Set(['journey', 'storm']);
const TOP_RECORDS = 10;
let recordSequence = 0;

function validScope(scope) {
  if (scope === 'all') return true;
  if (typeof scope !== 'string' || !/^daily:\d{4}-\d{2}-\d{2}$/.test(scope)) return false;
  const day = scope.slice(6);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function text(value, maxLength) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value.trim() : null;
}

function nonnegative(value, integer = false) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && (!integer || Number.isSafeInteger(value));
}

function normalize(record, defaults = false) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const id = text(record.id, 128) || (defaults && record.id == null ? `run-${Date.now().toString(36)}-${++recordSequence}-${Math.random().toString(36).slice(2, 10)}` : null);
  const mode = record.mode ?? 'journey';
  const scope = record.scope ?? 'all';
  const layoutName = text(record.layoutName, 100);
  const seed = typeof record.seed === 'string' ? text(record.seed, 128) : Number.isSafeInteger(record.seed) ? record.seed : null;
  const bonuses = record.bonuses ?? 0;
  const hits = record.hits ?? 0;
  const createdAt = record.createdAt ?? (defaults ? new Date().toISOString() : null);
  const date = typeof createdAt === 'string' || typeof createdAt === 'number' ? new Date(createdAt) : null;
  if (!id || !MODES.has(mode) || !validScope(scope) || !layoutName || seed === null ||
      !nonnegative(record.score, true) || !nonnegative(record.elapsed) ||
      !nonnegative(bonuses, true) || !nonnegative(hits, true) || !date || !Number.isFinite(date.getTime())) return null;
  if (record.level != null && (!Number.isSafeInteger(record.level) || record.level < 1 || record.level > 1000000)) return null;
  if (record.tier != null && (!Number.isSafeInteger(record.tier) || record.tier < 0 || record.tier > 5)) return null;
  return { id, mode, scope, seed, layoutName, score: record.score, elapsed: record.elapsed, bonuses, hits, createdAt: date.toISOString(),
    ...(record.level != null ? { level:record.level } : {}), ...(record.tier != null ? { tier:record.tier } : {}) };
}

function compare(a, b) {
  return (b.level ?? 0) - (a.level ?? 0) || b.score - a.score || a.elapsed - b.elapsed || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function trim(records) {
  const buckets = new Map();
  for (const record of records.sort(compare)) {
    const key = `${record.mode}|${record.scope}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = []);
    if (bucket.length < TOP_RECORDS && !bucket.some(existing => existing.id === record.id)) bucket.push(record);
  }
  return [...buckets.values()].flat();
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

/** Records belong to this browser. A blocked storage backend falls back to memory. */
export function createRecordStore(storage = defaultStorage()) {
  let records = [];
  let available = Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
  if (available) {
    try {
      const raw = storage.getItem(RECORDS_KEY);
      if (raw) {
        let payload;
        try { payload = JSON.parse(raw); } catch { payload = null; }
        if (payload?.version === 1 && Array.isArray(payload.records)) {
          records = trim(payload.records.map(record => normalize(record)).filter(Boolean));
        }
      }
    } catch { available = false; }
  }

  function list({ mode = 'journey', scope = 'all' } = {}) {
    if (!MODES.has(mode) || !validScope(scope)) return [];
    return records.filter(record => record.mode === mode && record.scope === scope).sort(compare).map(record => ({ ...record }));
  }

  return {
    get available() { return available; },
    list,
    add(candidate) {
      const record = normalize(candidate, true);
      if (!record) return false;
      const duplicate = records.some(existing => existing.id === record.id && existing.mode === record.mode && existing.scope === record.scope);
      if (!duplicate) {
        records = trim([...records, record]);
        if (available) {
          try { storage.setItem(RECORDS_KEY, JSON.stringify({ version: 1, records })); }
          catch { available = false; }
        }
      }
      return list(record);
    },
  };
}
