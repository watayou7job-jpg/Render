function computeScore(points, elapsedMs, timeLimitMs, minGuaranteeRatio) {
  const clampedElapsed = Math.max(0, Math.min(elapsedMs, timeLimitMs));
  const ratio = clampedElapsed / timeLimitMs;
  const score = points * (1 - ratio * (1 - minGuaranteeRatio));
  return Math.round(score);
}

module.exports = { computeScore };
