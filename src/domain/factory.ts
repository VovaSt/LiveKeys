import { createLayer, defaultPerformanceEffects, instruments, type LayerConfig, type LayerEffects, type EffectType, type PerformancePreset } from './models';

function layer(id: string, gainDb: number, wet: number, cutoff?: number): LayerConfig {
  const instrument = instruments.find(i => i.id === id);
  if (!instrument) throw new Error('Unknown factory instrument: ' + id);
  const result = createLayer(id, instrument);
  result.gainDb = gainDb;
  result.keyRange = instrument.category === 'pad' || instrument.category === 'dynamic' ? [36, 96] : [21, 108];
  result.effects.reverbSend = wet;
  result.effects.rack = [{ type: 'reverb', enabled: true }];
  if (instrument.category === 'pad' || instrument.category === 'dynamic') {
    result.keyFadeLow = 6; result.keyFadeHigh = 6;
  }
  if (instrument.category === 'piano') {
    result.effects.rack.unshift({ type: 'filter', enabled: true });
    result.effects.cutoff = cutoff ?? instrument.tone?.cutoff ?? 6500;
  } else if (cutoff) result.pad.cutoff = cutoff;
  return result;
}
function split(sound: LayerConfig, low: number, high: number, fadeLow = 0, fadeHigh = 0, octave = 0): LayerConfig {
  return { ...sound, keyRange: [low, high], keyFadeLow: fadeLow, keyFadeHigh: fadeHigh, octave };
}
function fx(sound: LayerConfig, types: EffectType[], settings: Partial<LayerEffects> = {}): LayerConfig {
  sound.effects = { ...sound.effects, reverbSend: 0, delaySend: 0, chorusBypass: true, ...settings,
    rack: types.map(type => ({ type, enabled: true })) };
  return sound;
}
function performance(id: string, name: string, layers: LayerConfig[]): PerformancePreset {
  const boost = -3 - Math.max(...layers.map(layer => layer.gainDb));
  for (const layer of layers) layer.gainDb += boost;
  // Dense arrangements use fewer pad voices and shorter tails to bound CPU load.
  if (layers.length >= 3) for (const sound of layers) {
    if (['pad', 'dynamic'].includes(sound.instrument.category ?? '')) {
      sound.voiceLimit = 6; sound.pad.release = Math.min(sound.pad.release, 2.5);
    }
  }
  return { schemaVersion: 3, id: 'worship-' + id, version: '5', name, layers, effects: { ...defaultPerformanceEffects } };
}
// Ten distinct roles, 1–4 layers; no more than two enabled effects per instrument.
export const factoryPresets: PerformancePreset[] = [
  performance('piano', '01 · Natural Grand — чистий', [layer('natural-grand', -12, 0.12, 7200)]),
  performance('prayer', '02 · Felt Piano — камерний', [
    fx(layer('felt-piano', -12, 0), ['eq', 'reverb'], { eqLow: -2, eqMid: 1, eqHigh: -2, reverbSend: 0.23 }),
    split(layer('warm-pad', -27, 0.14, 550), 36, 96, 12, 6)]),
  performance('warm', '03 · Warm Tine — скляний', [
    fx(layer('warm-tine', -12, 0), ['chorus', 'reverb'], { chorusBypass: false, chorusMix: 0.18, reverbSend: 0.12 }),
    split(layer('glass-pad', -25, 0.16, 4200), 48, 108, 12, 6)]),
  performance('verse', '04 · Soft Grand — повітряний', [
    layer('soft-grand', -12, 0.15, 3600),
    fx(split(layer('gentle-flute', -22, 0), 67, 108, 12), ['delay', 'reverb'], { delaySend: 0.1, reverbSend: 0.15 })]),
  performance('chorus', '05 · Bright Grand — широкий', [
    fx(layer('bright-grand', -12, 0), ['eq', 'reverb'], { eqLow: -2, eqMid: 1, eqHigh: 1, reverbSend: 0.1 }),
    split(layer('strings-pad', -24, 0.1, 2600), 36, 96, 12, 6),
    split(layer('aurora-motion', -28, 0.08, 3000), 48, 108, 12, 6)]),
  performance('shimmer', '06 · Rhodes — сяючий', [
    fx(layer('rhodes', -12, 0), ['drive', 'reverb'], { drive: 0.28, reverbSend: 0.15 }),
    layer('shimmer-pad', -23, 0.08, 6000),
    split(layer('soft-air', -29, 0.1, 3000), 48, 108, 12, 6, 1)]),
  performance('ocean', '07 · Felt Piano — глибокий', [
    fx(layer('felt-piano', -12, 0), ['eq', 'reverb'], { eqLow: -2, eqHigh: -1, reverbSend: 0.2 }),
    layer('ocean-bloom', -24, 0.1, 2200),
    split(layer('choir-bloom', -28, 0.1, 2800), 43, 96, 12, 6)]),
  performance('choir', '08 · Natural Grand — симфонічний', [
    fx(layer('natural-grand', -12, 0), ['eq', 'reverb'], { eqLow: -2, eqMid: 1, reverbSend: 0.12 }),
    split(layer('violin-orchestra', -23, 0.12, 4000), 36, 100, 12, 6),
    split(layer('choir', -26, 0.16, 3400), 43, 96, 12, 6),
    split(layer('wind-orchestra', -29, 0.08, 2800), 36, 84, 12, 12)]),
  performance('gospel', '09 · Rhodes — ламповий Gospel', [
    fx(layer('rhodes', -12, 0), ['drive', 'chorus'], { drive: 0.35, chorusBypass: false, chorusMix: 0.12 }),
    fx(layer('gospel-organ', -20, 0), ['drive', 'reverb'], { drive: 0.12, reverbSend: 0.08 })]),
  performance('strings', '10 · Soft Reed — насичений', [
    fx(layer('soft-reed', -12, 0), ['eq', 'chorus'], { eqLow: -2, eqMid: 1, chorusBypass: false, chorusMix: 0.1 }),
    fx(split(layer('brash-mono', -23, 0), 67, 108, 12), ['drive', 'delay'], { drive: 0.08, delaySend: 0.1 }),
    fx(split(layer('drawbar-organ', -25, 0), 36, 64, 6, 12, -1), ['eq'], { eqLow: -3, eqMid: -1 }),
    split(layer('warm-pad', -28, 0.08, 650), 36, 84, 12, 12)])
];
