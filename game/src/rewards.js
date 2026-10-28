/** Cosmetic rewards never change simulation rules or score. */
export const ACHIEVEMENTS = Object.freeze([
  Object.freeze({ id:'clean-run', name:'Untouchable', description:'Finish a verified trail without taking a hit.',
    reward:Object.freeze({ type:'palette', id:'moonlight', name:'Moonlight palette' }) }),
  Object.freeze({ id:'bonus-sweep', name:'Treasure seeker', description:'Collect both bonus coins and finish a verified trail.',
    reward:Object.freeze({ type:'trail', id:'spark', name:'Spark trail' }) }),
  Object.freeze({ id:'hunter-slayer', name:'Hunter slayer', description:'Defeat the hunter and finish a verified trail.',
    reward:Object.freeze({ type:'badge', id:'hunter', name:'Hunter badge' }) }),
]);

export const COSMETICS = Object.freeze({
  palette:Object.freeze([
    Object.freeze({ id:'classic', name:'Classic', achievementId:null }),
    Object.freeze({ id:'moonlight', name:'Moonlight', achievementId:'clean-run' }),
  ]),
  trail:Object.freeze([
    Object.freeze({ id:'none', name:'No trail', achievementId:null }),
    Object.freeze({ id:'spark', name:'Spark', achievementId:'bonus-sweep' }),
  ]),
  badge:Object.freeze([
    Object.freeze({ id:'none', name:'No badge', achievementId:null }),
    Object.freeze({ id:'hunter', name:'Hunter', achievementId:'hunter-slayer' }),
  ]),
});
export const DEFAULT_EQUIPPED = Object.freeze({ palette:'classic', trail:'none', badge:'none' });

/** Missing/corrupt older saves have a safe default without inventing unlocks. */
export function normalizeRewards(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  const unlocked = ACHIEVEMENTS.filter(item => Array.isArray(value?.unlocked) && value.unlocked.includes(item.id)).map(item => item.id);
  const equipped = { ...DEFAULT_EQUIPPED };
  for (const type of Object.keys(COSMETICS)) {
    const cosmetic = COSMETICS[type].find(item => item.id === value?.equipped?.[type]);
    if (cosmetic && (!cosmetic.achievementId || unlocked.includes(cosmetic.achievementId))) equipped[type] = cosmetic.id;
  }
  return { unlocked, equipped };
}

export function equipRewards(value, equipped) {
  const rewards = normalizeRewards(value), types = Object.keys(COSMETICS);
  if (!equipped || typeof equipped !== 'object' || Array.isArray(equipped)
    || Object.keys(equipped).length !== types.length || Object.keys(equipped).some(type => !types.includes(type))) {
    throw new RangeError('Choose a palette, trail and badge.');
  }
  for (const type of types) {
    const cosmetic = COSMETICS[type].find(item => item.id === equipped[type]);
    if (!cosmetic) throw new RangeError('That cosmetic is not available.');
    if (cosmetic.achievementId && !rewards.unlocked.includes(cosmetic.achievementId)) throw new RangeError('Complete the achievement to unlock this cosmetic.');
  }
  return { unlocked:rewards.unlocked, equipped:{ ...equipped } };
}

/** Call only with the server's verified replay outcome, never a submitted score. */
export function grantRewards(value, result) {
  const rewards = normalizeRewards(value);
  if (result?.status !== 'won') return { rewards, newAchievements:[] };
  const earned = {
    'clean-run':result.hits === 0,
    'bonus-sweep':Number.isSafeInteger(result.bonusCount) && result.bonusCount >= 2 && result.bonuses === result.bonusCount,
    'hunter-slayer':result.hunterDefeated === true,
  };
  const newAchievements = ACHIEVEMENTS.filter(item => earned[item.id] && !rewards.unlocked.includes(item.id)).map(item => item.id);
  rewards.unlocked = ACHIEVEMENTS.filter(item => rewards.unlocked.includes(item.id) || newAchievements.includes(item.id)).map(item => item.id);
  return { rewards, newAchievements };
}
