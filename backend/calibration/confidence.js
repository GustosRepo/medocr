// Confidence calibration harness: compute distribution statistics over sample texts
import { runExtraction } from '../rules/index.js';

export function calibrateConfidence(sampleTexts = []) {
  const stats = {
    samples: sampleTexts.length,
    tiers: { High: 0, Medium: 0, Low: 0, 'Manual Review': 0 },
    score: { min: null, max: null, avg: 0 },
    anchors: {},
    manualTriggers: { avg: 0 },
    bucket: {}, // score buckets (rounded half steps)
  };
  if (!sampleTexts.length) return stats;
  let scoreSum = 0; let triggersSum = 0;
  for (const text of sampleTexts) {
    const { result } = runExtraction([{ text }]);
    const tier = result.confidence;
    if (stats.tiers[tier] == null) stats.tiers[tier] = 0;
    stats.tiers[tier]++;
    const det = result.confidenceDetail || {};
    const s = typeof det.score === 'number' ? det.score : 0;
    scoreSum += s;
    if (stats.score.min == null || s < stats.score.min) stats.score.min = s;
    if (stats.score.max == null || s > stats.score.max) stats.score.max = s;
    // bucket to nearest 0.5
    const b = (Math.round(s * 2) / 2).toFixed(1);
    stats.bucket[b] = (stats.bucket[b] || 0) + 1;
    const anchors = det.anchors || {};
    for (const k of Object.keys(anchors)) {
      if (!stats.anchors[k]) stats.anchors[k] = { true: 0, false: 0 };
      stats.anchors[k][anchors[k] ? 'true' : 'false']++;
    }
    const mt = (det.manualTriggers || []).length;
    triggersSum += mt;
  }
  stats.score.avg = Number((scoreSum / sampleTexts.length).toFixed(3));
  stats.manualTriggers.avg = Number((triggersSum / sampleTexts.length).toFixed(3));
  return stats;
}
