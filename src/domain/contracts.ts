import type { MidiMessage, PerformancePreset, SamplePackManifest, VoiceIdentity } from './models';
export interface Diagnostics {
  audioOverloaded?: boolean; audioLoadSource?: 'playback' | 'estimate';
  limiterReduction?: number; effectsBytes?: number;
  stolenVoices?: number; retiringVoices?: number;
  state: string; ready: boolean; voices: number; nodes: number; voiceLimit: number;
  assets: number; pcmBytes: number; sampleRate: number;
  baseLatency?: number; outputLatency?: number; peakBefore: number; peakAfter: number;
}
export interface AudioEngine {
  init(): Promise<void>; resume(): Promise<void>; dispose(): Promise<void>;
  now(): number;
  preparePreset(preset: PerformancePreset): Promise<string>;
  activatePreparedPreset(id: string): void;
  updatePreset(preset: PerformancePreset): void;
  noteOn(voice: VoiceIdentity, velocity: number, time: number): boolean;
  noteOff(id: string, time: number, fast?: boolean): void;
  controlChange(message: MidiMessage): void;
  resetInput?(input: string, channel?: number): void;
  updateParameters(parameters: { masterDb?: number; voiceLimit?: 32 | 64; outputMono?: boolean }): void;
  panic(time: number): void; diagnostics(): Diagnostics;
  onVoiceEnded?: (id: string) => void;
}
export interface MidiInputInfo { id: string; name: string; manufacturer: string; selected: boolean }
export interface MidiService {
  connect(): Promise<void>; inputs(): MidiInputInfo[];
  select(id: string, enabled: boolean): void; dispose(): void;
}
export interface PresetRepository {
  list(): Promise<PerformancePreset[]>; save(preset: PerformancePreset): Promise<void>;
}
export interface SampleRepository<T> {
  load(manifest: SamplePackManifest): Promise<ReadonlyMap<string, T>>;
  readonly pcmBytes: number; clear(): void;
}
export interface PlatformCapabilities { audio: boolean; midi: boolean; secureContext: boolean; offline: boolean }
