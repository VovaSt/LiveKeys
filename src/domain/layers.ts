import type { LayerConfig, PerformancePreset, VelocityCurve } from './models';
/** Fade inside the input key range. Does not alter velocity or select a different sample layer. */
export function keyRangeGain(layer: LayerConfig, note: number): number {
  const [low, high] = layer.keyRange;
  if (note < low || note > high) return 0;
  const lowGain = layer.keyFadeLow ? (note - low) / layer.keyFadeLow : 1;
  const highGain = layer.keyFadeHigh ? (high - note) / layer.keyFadeHigh : 1;
  const amount = Math.max(0, Math.min(1, lowGain, highGain));
  return amount * amount * (3 - 2 * amount);
}
export function audibleLayers(preset: PerformancePreset): LayerConfig[] {
  const enabled = preset.layers.filter(l => l.enabled && !l.mute);
  return enabled.some(l => l.solo) ? enabled.filter(l => l.solo) : enabled;
}
export function curveVelocity(velocity: number, curve: VelocityCurve): number {
  if (curve === 'fixed') return 100;
  const normalized = velocity / 127;
  return Math.max(1, Math.min(127, Math.round(127 * (curve === 'soft' ? Math.sqrt(normalized) : curve === 'hard' ? normalized ** 2 : normalized))));
}
export function noteName(note: number): string {
  return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][note % 12]}${Math.floor(note / 12) - 1}`;
}
