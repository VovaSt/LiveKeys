import { catalog } from './catalog';
export interface Versioned { schemaVersion: 1; id: string; version: string }
export interface SampleZone {
  sampleSet?: string;
  id: string; url: string; rootNote: number;
  keyRange: [number, number]; velocityRange: [number, number];
  tuningCents: number; gainDb: number; loop?: { start: number; end: number };
}
export interface SamplePackManifest extends Versioned { zones: SampleZone[]; license: string; demo: boolean; decodeSampleRate?: number; mono?: boolean }
export interface SynthProfile {
  parts?: { wave: 'sine' | 'triangle' | 'sawtooth' | 'square'; ratio: number; detune: number; gain: number; pan: number; attack: number; cutoff: number; formant?: number }[];
  swell?: number; resonance?: number; filterEnvelope?: number;
  model: 'subtractive' | 'fm'; wave: 'sine' | 'triangle' | 'sawtooth' | 'square'; secondWave: 'sine' | 'triangle' | 'sawtooth' | 'square';
  detune: number; ratio: number; attack: number; decay: number; sustain: number; release: number; cutoff: number;
  movement: number; lfoRate: number; level: number; fmIndex: number; mono: boolean; glide: number;
}
export type InstrumentDefinition = Versioned & ({ kind: 'sampler'; packId: string; packVersion: string; sampleSet?: string; sustained?: boolean } | { kind: 'synth'; profile?: SynthProfile });
export type VelocityCurve = 'linear' | 'soft' | 'hard' | 'fixed';
export interface PadParameters { attack: number; release: number; cutoff: number; movement?: number }
export const instrumentCategories = [
  { id: 'piano', name: 'Фортепіано' }, { id: 'electric', name: 'Електро-піано' },
  { id: 'organ', name: 'Орган' }, { id: 'orchestra', name: 'Оркестр' },
  { id: 'pad', name: 'Прості педи' }, { id: 'dynamic', name: 'Динамічні педи' }, { id: 'lead', name: 'Ліди' }
] as const;
export interface InstrumentPreset extends Versioned { name: string; definition: InstrumentDefinition; category?: typeof instrumentCategories[number]['id']; tone?: { cutoff: number; gainDb: number }; padDefaults?: PadParameters }
export type EffectType = 'filter' | 'chorus' | 'reverb' | 'delay' | 'eq' | 'drive';
export interface EffectSlot { type: EffectType; enabled: boolean }
export interface LayerEffects { cutoff: number; resonance: number; chorusRate: number; chorusDepth: number; chorusMix: number; chorusBypass: boolean; reverbSend: number; delaySend: number; rack?: EffectSlot[]; eqLow?: number; eqMid?: number; eqHigh?: number; drive?: number }
export interface PerformanceEffects { reverbDecay: number; reverbBypass: boolean; delayTime: number; feedback: number; delayBypass: boolean; delaySync: boolean; division: '1/4' | '1/8' | '3/16'; bpm: number; eqLow: number; eqMid: number; eqHigh: number; eqBypass?: boolean; ceiling: number }
export const defaultLayerEffects: LayerEffects = { cutoff: 20000, resonance: 0.7, chorusRate: 0.7, chorusDepth: 0.003, chorusMix: 0.2, chorusBypass: true, reverbSend: 0, delaySend: 0 };
export const defaultPerformanceEffects: PerformanceEffects = { reverbDecay: 1.8, reverbBypass: false, delayTime: 0.35, feedback: 0.25, delayBypass: false, delaySync: true, division: '1/8', bpm: 80, eqLow: 0, eqMid: 0, eqHigh: 0, eqBypass: false, ceiling: -1 };
export interface LayerConfig {
  id: string; instrument: InstrumentPreset; enabled: boolean; mute: boolean; solo: boolean;
  keyRange: [number, number]; velocityRange: [number, number];
  /** Retained for old JSON compatibility; playback uses global transpose only. */
  transpose: number; octave?: number; keyFadeLow?: number; keyFadeHigh?: number; fineTune: number; gainDb: number; pan: number;
  inputs: string[]; channel: number | 'omni'; sustainEnabled: boolean;
  velocityCurve: VelocityCurve; pad: PadParameters; voiceLimit?: number;
  effects: LayerEffects; mono: boolean; glide: number; expressionEnabled: boolean; bendRange: number;
}
export interface PerformancePreset extends Omit<Versioned, 'schemaVersion'> { schemaVersion: 3; name: string; layers: LayerConfig[]; effects: PerformanceEffects }
export interface Setlist extends Versioned { songs: { title: string; bpm: number; presetId: string }[] }
export interface MidiMapping extends Versioned { input: string; channel: number; cc: number; target: string }
export interface AppSettings { schemaVersion: 1; masterDb: number; selectedInputs: string[]; voiceLimit: 32 | 64; globalTranspose: number; outputMono: boolean }
export interface VoiceIdentity {
  id: string; input: string; channel: number; note: number;
  presetInstance: string; layer: string; pitch: number;
  glideFrom?: number;
}
/** Time throughout domain/engine contracts is seconds in the audio clock. */
export type MidiMessage = { input: string; channel: number; time: number } & (
  { type: 'on' | 'off'; note: number; velocity: number } |
  { type: 'cc'; controller: number; value: number } | { type: 'bend'; value: number }
);
export const pianoPreset: PerformancePreset = {
  schemaVersion: 3, id: 'natural-grand-demo', version: '2', name: 'Natural Piano', effects: { ...defaultPerformanceEffects },
  layers: [{ id: 'piano', enabled: true, mute: false, solo: false,
    keyRange: [0, 127], velocityRange: [1, 127], transpose: 0, fineTune: 0,
    gainDb: -12, pan: 0, inputs: [], channel: 'omni', sustainEnabled: true,
    velocityCurve: 'linear', voiceLimit: 10, pad: { attack: 0.7, release: 1.8, cutoff: 1800, movement: 0.15 },
    effects: { ...defaultLayerEffects, cutoff: 6500, reverbSend: 0.12, rack: [{ type: 'filter', enabled: true }, { type: 'reverb', enabled: true }] }, mono: false, glide: 0, expressionEnabled: true, bendRange: 2,
    instrument: catalog[0]!
  }]
};
export const padInstrument = catalog[1]!;
export const instruments = catalog;
export function createLayer(id: string, instrument = padInstrument): LayerConfig {
  const profile = instrument.definition.kind === 'synth' ? instrument.definition.profile : undefined;
  return { ...structuredClone(pianoPreset.layers[0]!), id, instrument: structuredClone(instrument),
    gainDb: instrument.tone?.gainDb ?? (['pad', 'dynamic', 'orchestra'].includes(instrument.category ?? '') ? -18 : -12),
    mono: profile?.mono ?? false, glide: profile?.glide ?? 0, sustainEnabled: instrument.category !== 'lead',
    pad: instrument.padDefaults ? { ...instrument.padDefaults } : { attack: Math.max(0.001, profile?.attack ?? 0.7), release: profile?.release ?? 1.8, cutoff: profile?.cutoff ?? 1800, movement: profile?.movement ?? 0 },
    effects: { ...defaultLayerEffects, cutoff: instrument.tone?.cutoff ?? 20000,
      chorusBypass: true, chorusMix: 0.2,
      reverbSend: instrument.category === 'piano' ? 0.12 : 0.2,
      drive: instrument.id === 'rhodes' ? 0.28 : 0,
      rack: instrument.id === 'rhodes' ? [{ type: 'drive', enabled: true }, { type: 'reverb', enabled: true }] :
        instrument.category === 'piano' ? [{ type: 'filter', enabled: true }, { type: 'reverb', enabled: true }] :
        instrument.category === 'electric' ? [{ type: 'chorus', enabled: true }, { type: 'reverb', enabled: true }] :
        instrument.category === 'lead' ? [{ type: 'delay', enabled: true }] : [{ type: 'reverb', enabled: true }],
      delaySend: instrument.category === 'lead' ? 0.15 : 0 } };
}
export const defaultSettings: AppSettings = { schemaVersion: 1, masterDb: -6, selectedInputs: [], voiceLimit: 64, globalTranspose: 0, outputMono: false };
