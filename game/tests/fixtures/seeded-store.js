/** Use reproducible maps in persistence tests; gameplay still replays actual inputs. */
export function withSeededProfiles(store, seed) {
  return { ...store, async upsertProfile(board, profile) {
    await store.upsertProfile(board, profile);
    await store.transaction(board, profile.id, async tx => {
      const row = await tx.profile();
      if (row && row.progress == null) await tx.saveProgress(JSON.stringify({
        version:1, seed, level:1, skill:0, streak:0, attempt:0, recentMaps:[], active:null,
      }));
    });
  } };
}
