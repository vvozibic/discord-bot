export const SIMULATION_STEP = 1 / 60;
const MAX_CATCHUP = .25;

export function createFixedStepper(simulate) {
  let accumulator=0;
  return {
    advance(elapsed) {
      if (!Number.isFinite(elapsed)||elapsed<=0) return 0;
      accumulator+=Math.min(elapsed,MAX_CATCHUP);
      let steps=0;
      while (accumulator+1e-10>=SIMULATION_STEP) {
        simulate(SIMULATION_STEP);
        accumulator=Math.max(0,accumulator-SIMULATION_STEP);
        steps++;
      }
      return steps;
    },
    reset() { accumulator=0; },
  };
}
