import * as world from './world.js';
import { createDesertArt, createIceArt } from './biome-desert-ice.js';
import { createVolcanicArt, createMarshArt } from './biome-volcanic-marsh.js';
import { createNeonArt, createLunarArt } from './biome-neon-lunar.js';
import { createCloudArt, createCoralArt } from './biome-cloud-coral.js';
import { createCrystalArt, createClockworkArt } from './biome-crystal-clockwork.js';

const painters = Object.freeze({
  'desert-ruins':createDesertArt, 'ice-cavern':createIceArt,
  'volcanic-isles':createVolcanicArt, 'mushroom-marsh':createMarshArt,
  'neon-district':createNeonArt, 'lunar-outpost':createLunarArt,
  'cloud-citadel':createCloudArt, 'coral-sanctum':createCoralArt,
  'crystal-depths':createCrystalArt, 'clockwork-vault':createClockworkArt,
});

export const BIOME_THEMES = Object.freeze(Object.keys(painters));

export function createBiomeArt(theme) {
  const paint = painters[theme];
  if (!paint) throw new RangeError(`Unknown environment: ${theme}`);
  return paint(world);
}
