/** Present finite hit budgets as health without changing simulation rules. */
export function getHealth(run = {}) {
  const limit = run.maxHits;
  if (!Number.isFinite(limit) || limit <= 0) {
    return { enabled:false, current:null, max:100, ratio:null, remainingHits:null };
  }
  const hits = Number.isFinite(run.hits) ? Math.max(0, run.hits) : 0;
  const remainingHits = Math.max(0, Math.min(limit, limit - hits));
  const ratio = remainingHits / limit;
  return { enabled:true, current:Math.round(ratio * 100), max:100, ratio, remainingHits };
}
