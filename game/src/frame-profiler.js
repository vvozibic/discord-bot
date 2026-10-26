// Local, aggregate timing data for diagnostics. No user data or network calls.
export function createFrameProfiler(canvas) {
  let previous = null, windowStart = null, intervals = [], updateTotal = 0, drawTotal = 0;
  return {
    record(now, updateMs, drawMs, visible = true) {
      if (!visible) {
        previous = null; windowStart = null; intervals = []; updateTotal = 0; drawTotal = 0;
        return;
      }
      if (previous !== null) {
        intervals.push(now - previous);
        updateTotal += updateMs; drawTotal += drawMs;
      }
      previous = now;
      windowStart ??= now;
      if (now - windowStart < 1000 || !intervals.length) return;
      const sorted = [...intervals].sort((a, b) => a - b);
      canvas.dataset.fps = (intervals.length * 1000 / (now - windowStart)).toFixed(1);
      canvas.dataset.frameP95Ms = sorted[Math.floor((sorted.length - 1) * .95)].toFixed(2);
      canvas.dataset.frameMaxMs = sorted[sorted.length - 1].toFixed(2);
      canvas.dataset.updateMs = (updateTotal / intervals.length).toFixed(3);
      canvas.dataset.drawMs = (drawTotal / intervals.length).toFixed(3);
      intervals = []; updateTotal = 0; drawTotal = 0; windowStart = now;
    },
  };
}
