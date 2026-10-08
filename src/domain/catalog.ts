import type { InstrumentPreset, SynthProfile } from './models';
const base: SynthProfile = { model: 'subtractive', wave: 'sawtooth', secondWave: 'triangle', detune: 5, ratio: 1,
  attack: 0.7, decay: 0.8, sustain: 0.7, release: 1.8, cutoff: 1800, movement: 0.15, lfoRate: 0.23, level: 0.22, fmIndex: 0,
  mono: false, glide: 0 };
function synth(id: string, name: string, category: InstrumentPreset['category'], p: Partial<SynthProfile>): InstrumentPreset {
  return { schemaVersion: 1, id, version: '1', name, category,
    definition: { schemaVersion: 1, id: id === 'warm-pad' ? 'warm-pad-synth' : id + '-synth', version: '1', kind: 'synth', profile: { ...base, lfoRate: category === 'lead' ? 5 : base.lfoRate, ...p, ...(category === 'pad' ? { cutoff: ({ 'glass-pad': 4200, 'soft-air': 2400, 'strings-pad': 2200 } as Record<string, number>)[id] ?? 400 } : {}) } } };
}
function grand(id: string, name: string, cutoff: number, gainDb: number): InstrumentPreset {
  return { schemaVersion: 1, id, version: id === 'natural-grand' ? '2' : '1', name, category: 'piano',
    definition: { schemaVersion: 1, id: 'salamander-3v', version: '1', kind: 'sampler', packId: 'salamander-3v', packVersion: '1' },
    tone: { cutoff, gainDb } };
}
const part = (wave: SynthProfile['wave'], ratio: number, detune: number, gain: number, pan: number, attack = 0.02, cutoff = 10000, formant?: number): NonNullable<SynthProfile['parts']>[number] =>
  ({ wave, ratio, detune, gain, pan, attack, cutoff, ...(formant ? { formant } : {}) });
export const synthCatalog: InstrumentPreset[] = [
  grand('natural-grand', 'Natural Grand', 6500, -12),
  synth('warm-pad', 'Warm Pad', 'pad', {}),
  synth('gentle-flute', 'Gentle Flute', 'lead', { wave: 'sine', secondWave: 'triangle', ratio: 2, detune: 0,
    attack: 0.045, decay: 0.25, sustain: 0.8, release: 0.24, cutoff: 2600, movement: 0,
    lfoRate: 5, mono: true, glide: 0.025, level: 0.26 }),
  // Reference spectrum: prominent second harmonic with both odd/even upper partials.
  synth('brash-mono', 'Brash Mono Lead', 'lead', { attack: 0.008, decay: 0.18, sustain: 0.88,
    release: 0.14, cutoff: 5800, resonance: 0.7, filterEnvelope: 1400, movement: 0,
    mono: true, glide: 0.035, level: 0.24,
    parts: [part('sawtooth', 1, -2, 0.6, 0, 0.004), part('square', 2, 2, 0.6, 0, 0.004)] }),
  grand('soft-grand', 'Soft Grand', 2800, -14), grand('bright-grand', 'Bright Grand', 18000, -13),
  synth('warm-tine', 'Warm Tine', 'electric', { model: 'fm', wave: 'sine', ratio: 1, fmIndex: 2.2, attack: 0.005, decay: 3.5, sustain: 0.015, release: 0.4, cutoff: 6000, level: 0.48, movement: 0 }),
  synth('bright-tine', 'Bright Tine', 'electric', { model: 'fm', wave: 'sine', ratio: 3, fmIndex: 4.5, attack: 0.003, decay: 2.1, sustain: 0.008, release: 0.3, cutoff: 10000, level: 0.38, movement: 0 }),
  synth('soft-reed', 'Soft Reed', 'electric', { model: 'fm', wave: 'triangle', ratio: 2, fmIndex: 0.8, attack: 0.009, decay: 1.8, sustain: 0.02, release: 0.25, cutoff: 3200, level: 0.4, movement: 0.1, lfoRate: 4.8 }),
  synth('soft-air', 'Soft Air', 'pad', { wave: 'triangle', secondWave: 'sine', ratio: 2, attack: 1.4, release: 2.8, cutoff: 5400, detune: 12, movement: 0.3 }),
  
  synth('strings-pad', 'Strings', 'pad', { secondWave: 'sawtooth', detune: 8, attack: 0.18, decay: 0.4, sustain: 0.85, release: 0.8, cutoff: 5000, lfoRate: 5.1, movement: 0.15 }),
  synth('glass-pad', 'Glass', 'pad', { wave: 'sine', secondWave: 'triangle', ratio: 3, detune: 2, attack: 0.15, decay: 1.8, sustain: 0.4, release: 2.5, cutoff: 6500, movement: 0.1 }),
  
  synth('ambient-pad', 'Ambient', 'pad', { wave: 'triangle', secondWave: 'sine', ratio: 0.5, attack: 3, release: 5, cutoff: 1300, movement: 0.6, lfoRate: 0.07 }),
  synth('soft-analog', 'Soft Analog', 'lead', { wave: 'triangle', secondWave: 'sine', attack: 0.025, release: 0.2, cutoff: 3500, movement: 0.1, lfoRate: 5.2, level: 0.32 }),
  synth('warm-mono', 'Warm Mono', 'lead', { wave: 'square', secondWave: 'triangle', attack: 0.015, release: 0.15, cutoff: 1900, detune: 3, mono: true, glide: 0.08, movement: 0, level: 0.22 }),
  
  synth('rhodes', 'Rhodes', 'electric', { model: 'fm', wave: 'sine', ratio: 1, fmIndex: 3.2,
    attack: 0.006, decay: 2.8, sustain: 0.025, release: 0.42, cutoff: 4200, movement: 0, level: 0.44 }),
  
  synth('drawbar-organ', 'Drawbar Organ', 'organ', { attack: 0.004, decay: 0.1, sustain: 1, release: 0.08, cutoff: 9000, movement: 0, level: 0.32,
    parts: [part('sine', 1, 0, 1, 0), part('sine', 2, 0, 0.55, -0.15), part('sine', 3, 0, 0.3, 0.15), part('sine', 4, 0, 0.15, 0)] }),
  synth('gospel-organ', 'Gospel Organ', 'organ', { attack: 0.006, decay: 0.15, sustain: 0.95, release: 0.13, cutoff: 6500, movement: 0.08, lfoRate: 5.6, swell: 0.16, level: 0.3,
    parts: [part('sine', 0.5, 0, 0.45, 0), part('sine', 1, -2, 1, -0.35), part('sine', 2, 2, 0.5, 0.35), part('triangle', 3, 0, 0.16, 0)] }),
  synth('reed-organ', 'Reed Organ', 'organ', { attack: 0.02, decay: 0.15, sustain: 1, release: 0.12, cutoff: 2800, movement: 0, level: 0.23,
    parts: [part('square', 1, -3, 0.75, -0.25), part('triangle', 2, 3, 0.45, 0.25), part('sine', 4, 0, 0.15, 0)] }),
  synth('violin-orchestra', 'Скрипковий оркестр', 'orchestra', { attack: 0.24, decay: 0.5, sustain: 0.85, release: 1.1, cutoff: 5600, movement: 0.12, lfoRate: 5.1, level: 0.2,
    parts: [part('sawtooth', 1, -9, 0.65, -0.8, 0.22, 6500), part('sawtooth', 1, 9, 0.65, 0.8, 0.31, 6000), part('triangle', 2, 3, 0.25, 0, 0.4)] }),
  synth('wind-orchestra', 'Духовий оркестр', 'orchestra', { attack: 0.07, decay: 0.45, sustain: 0.75, release: 0.45, cutoff: 3200, filterEnvelope: 2600, resonance: 0.9, movement: 0.06, level: 0.22,
    parts: [part('sawtooth', 1, -5, 0.6, -0.5, 0.07), part('square', 1, 5, 0.35, 0.5, 0.1, 2200), part('triangle', 0.5, 0, 0.4, 0, 0.13)] }),
  synth('symphonic-orchestra', 'Симфонічний оркестр', 'orchestra', { attack: 0.3, decay: 0.8, sustain: 0.85, release: 1.6, cutoff: 4800, movement: 0.2, swell: 0.12, level: 0.19,
    parts: [part('sawtooth', 1, -10, 0.6, -0.8, 0.25), part('sawtooth', 1, 10, 0.6, 0.8, 0.4), part('triangle', 0.5, 0, 0.5, -0.15, 0.2), part('square', 2, 2, 0.18, 0.3, 0.65, 2400)] }),
  synth('choir', 'Хор', 'orchestra', { attack: 0.55, decay: 0.8, sustain: 0.85, release: 1.8, cutoff: 6500, movement: 0.07, swell: 0.12, lfoRate: 0.27, level: 0.32,
    parts: [part('sawtooth', 1, -6, 0.8, -0.65, 0.4, 6000, 750), part('sawtooth', 1, 6, 0.65, 0.65, 0.6, 6000, 1150), part('sawtooth', 2, 0, 0.3, 0, 0.7, 6000, 2600)] }),
  synth('aurora-motion', 'Aurora Motion', 'dynamic', { attack: 1.2, decay: 1.4, sustain: 0.85, release: 3.2, cutoff: 3200, movement: 0.7, swell: 0.4, lfoRate: 0.17, level: 0.18,
    parts: [part('sawtooth', 1, -14, 0.6, -0.9, 0.3, 2200), part('sawtooth', 1, 14, 0.6, 0.9, 1.3, 3200), part('triangle', 2, 3, 0.35, 0.25, 2.4), part('sine', 0.5, 0, 0.5, 0, 0.1)] }),
  synth('ocean-bloom', 'Ocean Bloom', 'dynamic', { attack: 1.6, decay: 2, sustain: 0.9, release: 4, cutoff: 2400, movement: 0.8, swell: 0.55, lfoRate: 0.11, level: 0.19,
    parts: [part('triangle', 1, -18, 0.75, -0.85, 0.4), part('sawtooth', 1, 18, 0.45, 0.85, 2, 1500), part('triangle', 2, 5, 0.3, -0.3, 3), part('sine', 0.5, 0, 0.45, 0.1, 0.3)] }),
  synth('funk-butter', 'Funk Butter', 'lead', { wave: 'sawtooth', secondWave: 'square', ratio: 0.5, detune: 5, attack: 0.005, decay: 0.22, sustain: 0.7, release: 0.12, cutoff: 900, filterEnvelope: 3800, resonance: 2.2, movement: 0, mono: true, glide: 0.055, level: 0.18 }),
  
];
const sampleSets: Record<string, string> = {
  'warm-pad': '89', 'soft-air': '95', 'strings-pad': '48',
  'glass-pad': '92', 'ambient-pad': '95', 'violin-orchestra': '48', 'wind-orchestra': '61',
  'symphonic-orchestra': 'symphony', choir: '52', 'aurora-motion': 'aurora', 'ocean-bloom': 'ocean', };
const sampledCatalog: InstrumentPreset[] = synthCatalog.map(instrument => {
  const sampleSet = sampleSets[instrument.id];
  if (!sampleSet || instrument.definition.kind !== 'synth') return instrument;
  const profile = instrument.definition.profile!;
  return { ...instrument, version: '2', padDefaults: { attack: profile.attack, release: profile.release, cutoff: profile.cutoff, movement: 0 },
    definition: { schemaVersion: 1, id: instrument.id + '-sampled', version: '1', kind: 'sampler',
      packId: 'fluid-ensemble', packVersion: '1', sampleSet, sustained: true } };
});
const sampledPad = (id: string, name: string, attack: number, release: number, cutoff: number): InstrumentPreset => ({
  schemaVersion: 1, id, version: '1', name, category: 'dynamic',
  padDefaults: { attack, release, cutoff, movement: 0 },
  definition: { schemaVersion: 1, id: id + '-sampled', version: '1', kind: 'sampler',
    packId: 'worship-textures', packVersion: '1', sampleSet: id, sustained: true }
});
export const catalog: InstrumentPreset[] = [
  ...sampledCatalog,
  { schemaVersion: 1, id: 'felt-piano', version: '1', name: 'Felt Piano', category: 'piano',
    definition: { schemaVersion: 1, id: 'felt-piano', version: '1', kind: 'sampler', packId: 'felt-piano', packVersion: '1' },
    tone: { cutoff: 6500, gainDb: -13 } },
  sampledPad('shimmer-pad', 'Shimmer Pad', 1.4, 3.2, 5800),
  sampledPad('choir-bloom', 'Choir Bloom', 1.8, 3.6, 3000)
];
