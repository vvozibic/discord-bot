/** Variants change the route's pressure, never its score or character abilities. */
export const LEVEL_VARIANTS = Object.freeze([
  Object.freeze({ id:'pursuit', name:'Hunter pursuit',
    description:'Fewer environmental hazards leave room to evade and confront the hunter.', recommendedCharacter:'wizard' }),
  Object.freeze({ id:'machinery', name:'Ancient machinery',
    description:'More machinery, with a slower hunter that wakes after coin 4.', recommendedCharacter:'robot' }),
]);

export function levelVariantFor(config = {}) {
  if (!(config.rulesVersion >= 13)) return null;
  return LEVEL_VARIANTS.find(variant => variant.id === config.variant) ?? null;
}
