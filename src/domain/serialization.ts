import { instruments, defaultSettings, type AppSettings, type LayerConfig, type PerformancePreset, type VelocityCurve, type LayerEffects, type PerformanceEffects } from './models';
import { effectRack, effectTypes } from './effects';
import type { EffectSlot, EffectType } from './models';
export class DataError extends Error {
  constructor(readonly code: 'invalid' | 'version' | 'missing-instrument' | 'size') { super(code); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataError('invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new DataError('invalid');
  return value.trim();
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new DataError('invalid');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new DataError('invalid'); return value;
}
function range(value: unknown, min: number): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new DataError('invalid');
  const a = number(value[0], min, 127, true), b = number(value[1], min, 127, true);
  if (a > b) throw new DataError('invalid'); return [a, b];
}
function id(value: unknown): string {
  const result = text(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new DataError('invalid'); return result;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) throw new DataError('invalid');
  return [...new Set(value.map(v => text(v, 256)))];
}
function layerEffects(value: unknown): LayerEffects {
  const e = object(value);
  const result: LayerEffects = { cutoff: number(e['cutoff'], 100, 20000), resonance: number(e['resonance'], 0.1, 6), chorusRate: number(e['chorusRate'], 0.05, 5),
    chorusDepth: number(e['chorusDepth'], 0, 0.008), chorusMix: number(e['chorusMix'], 0, 1), chorusBypass: bool(e['chorusBypass']),
    reverbSend: number(e['reverbSend'], 0, 1), delaySend: number(e['delaySend'], 0, 1) };
  if (e['rack'] === undefined) result.rack = effectRack(result);
  else {
    if (!Array.isArray(e['rack']) || e['rack'].length > 2) throw new DataError('invalid');
    result.rack = e['rack'].map(value => {
      const slot = object(value);
      if (!effectTypes.includes(slot['type'] as EffectType)) throw new DataError('invalid');
      return { type: slot['type'] as EffectType, enabled: bool(slot['enabled']) } satisfies EffectSlot;
    });
    if (new Set(result.rack.map(slot => slot.type)).size !== result.rack.length) throw new DataError('invalid');
  }
  for (const key of ['eqLow', 'eqMid', 'eqHigh'] as const) if (e[key] !== undefined) result[key] = number(e[key], -12, 12);
  if (e['drive'] !== undefined) result.drive = number(e['drive'], 0, 1);
  return result;
}
function performanceEffects(value: unknown): PerformanceEffects {
  const e = object(value); const division = e['division'];
  if (division !== '1/4' && division !== '1/8' && division !== '3/16') throw new DataError('invalid');
  return { reverbDecay: number(e['reverbDecay'], 0.3, 6), reverbBypass: bool(e['reverbBypass']), delayTime: number(e['delayTime'], 0.03, 2),
    feedback: number(e['feedback'], 0, 0.85), delayBypass: bool(e['delayBypass']), delaySync: bool(e['delaySync']), division,
    bpm: number(e['bpm'], 40, 240), eqLow: number(e['eqLow'], -12, 12), eqMid: number(e['eqMid'], -12, 12), eqHigh: number(e['eqHigh'], -12, 12), eqBypass: bool(e['eqBypass'] ?? false), ceiling: number(e['ceiling'], -12, -0.1) };
}
export function parsePreset(value: unknown): PerformancePreset {
  const p = object(value);
  if (p['schemaVersion'] !== 3) throw new DataError('version');
  if (!Array.isArray(p['layers']) || !p['layers'].length || p['layers'].length > 4) throw new DataError('invalid');
  const layers: LayerConfig[] = p['layers'].map(value => {
    const l = object(value), i = object(l['instrument']), d = object(i['definition']);
    const instrument = instruments.find(candidate => candidate.id === i['id'] && candidate.version === i['version']);
    if (!instrument || i['schemaVersion'] !== 1 || d['schemaVersion'] !== 1 || d['id'] !== instrument.definition.id ||
      d['version'] !== instrument.definition.version || d['kind'] !== instrument.definition.kind) throw new DataError('missing-instrument');
    if (instrument.definition.kind === 'sampler' && (d['packId'] !== instrument.definition.packId || d['packVersion'] !== instrument.definition.packVersion)) throw new DataError('missing-instrument');
    const pad = object(l['pad']);
    const curve = l['velocityCurve'];
    if (!['linear', 'soft', 'hard', 'fixed'].includes(String(curve))) throw new DataError('invalid');
    return {
      id: id(l['id']), instrument: structuredClone(instrument), enabled: bool(l['enabled']), mute: bool(l['mute']), solo: bool(l['solo']) && !bool(l['mute']) && bool(l['enabled']),
      keyRange: range(l['keyRange'], 0), velocityRange: range(l['velocityRange'], 1),
      transpose: number(l['transpose'], -24, 24, true), fineTune: number(l['fineTune'], -100, 100),
      ...(l['octave'] === undefined ? {} : { octave: number(l['octave'], -3, 3, true) }),
      ...(l['keyFadeLow'] === undefined ? {} : { keyFadeLow: number(l['keyFadeLow'], 0, 24, true) }),
      ...(l['keyFadeHigh'] === undefined ? {} : { keyFadeHigh: number(l['keyFadeHigh'], 0, 24, true) }),
      gainDb: number(l['gainDb'], -60, 0), pan: number(l['pan'], -1, 1), inputs: strings(l['inputs']),
      channel: l['channel'] === 'omni' ? 'omni' : number(l['channel'], 1, 16, true),
      sustainEnabled: bool(l['sustainEnabled']), velocityCurve: curve as VelocityCurve,
      voiceLimit: number(l['voiceLimit'] ?? 10, 1, 32, true),
      pad: { attack: number(pad['attack'], 0.001, 5), release: number(pad['release'], 0.05, 10), cutoff: number(pad['cutoff'], 100, 12000), movement: number(pad['movement'] ?? 0, 0, 1) },
      effects: layerEffects(l['effects']),
      mono: bool(l['mono']), glide: number(l['glide'], 0, 1),
      expressionEnabled: bool(l['expressionEnabled']),
      bendRange: number(l['bendRange'], 0, 12)
    };
  });
  if (new Set(layers.map(l => l.id)).size !== layers.length) throw new DataError('invalid');
  return { schemaVersion: 3, id: id(p['id']), version: text(p['version'], 20), name: text(p['name'], 80), layers,
    effects: performanceEffects(p['effects']) };
}
export function parseSettings(value: unknown): AppSettings {
  const s = object(value);
  if (s['schemaVersion'] !== 1) throw new DataError('version');
  const limit = number(s['voiceLimit'], 32, 64, true);
  if (limit !== 32 && limit !== 64) throw new DataError('invalid');
  return { schemaVersion: 1, masterDb: number(s['masterDb'], -60, 0), voiceLimit: limit,
    selectedInputs: strings(s['selectedInputs']), globalTranspose: number(s['globalTranspose'] ?? 0, -12, 12, true), outputMono: bool(s['outputMono'] ?? false) };
}
export interface Backup {
  format: 'live-keys'; schemaVersion: 3; presets: PerformancePreset[]; settings: AppSettings;
  dependencies: { id: string; version: string }[];
}
export const MAX_BACKUP_BYTES = 1024 * 1024;
export function makeBackup(presets: PerformancePreset[], settings: AppSettings = defaultSettings): Backup {
  if (!presets.length || presets.length > 100) throw new DataError('size');
  const validated = presets.map(parsePreset);
  const dependencies = new Map<string, { id: string; version: string }>();
  for (const p of validated) for (const l of p.layers) if (l.instrument.definition.kind === 'sampler') {
    const d = l.instrument.definition; dependencies.set(d.packId, { id: d.packId, version: d.packVersion });
  }
  const backup: Backup = { format: 'live-keys', schemaVersion: 3, presets: validated, settings: parseSettings(settings), dependencies: [...dependencies.values()] };
  if (new TextEncoder().encode(JSON.stringify(backup, null, 2)).byteLength > MAX_BACKUP_BYTES) throw new DataError('size');
  return backup;
}
export function parseBackup(json: string): Backup {
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new DataError('size');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new DataError('invalid'); }
  const b = object(value);
  if (b['format'] !== 'live-keys' || b['schemaVersion'] !== 3) throw new DataError('version');
  if (!Array.isArray(b['presets']) || !b['presets'].length || b['presets'].length > 100) throw new DataError('size');
  const result = makeBackup(b['presets'].map(parsePreset), parseSettings(b['settings']));
  if (new Set(result.presets.map(p => p.id)).size !== result.presets.length) throw new DataError('invalid');
  if (!Array.isArray(b['dependencies']) || b['dependencies'].length > 10) throw new DataError('invalid');
  for (const value of b['dependencies']) {
    const dependency = object(value);
    if (!['salamander-3v', 'fluid-ensemble', 'felt-piano', 'worship-textures'].includes(String(dependency['id'])) || dependency['version'] !== '1') throw new DataError('missing-instrument');
  }
  if (result.dependencies.some(d =>
    !(b['dependencies'] as Record<string, unknown>[]).some(x => x['id'] === d.id && x['version'] === d.version))) throw new DataError('missing-instrument');
  return result;
}
