import { expect, it } from 'vitest';
import { addEffect, effectiveEffects, effectRack } from '../../src/domain/effects';
import { defaultLayerEffects, pianoPreset } from '../../src/domain/models';
import { parsePreset } from '../../src/domain/serialization';
it('limits racks to two distinct effects including disabled slots', () => {
  const first = addEffect({ ...defaultLayerEffects, rack: [] }, 'reverb');
  const second = addEffect(first, 'chorus'); second.rack![0]!.enabled = false;
  expect(addEffect(second, 'delay')).toBe(second);
  expect(addEffect(first, 'reverb')).toBe(first);
  expect(second.rack).toHaveLength(2);
});
it('round-trips layer EQ and Drive and validates their ranges', () => {
  const preset = structuredClone(pianoPreset);
  preset.layers[0]!.effects = { ...preset.layers[0]!.effects, rack: [{ type: 'eq', enabled: true }, { type: 'drive', enabled: false }], eqLow: -4, eqMid: 6, eqHigh: 2, drive: 0.7 };
  expect(parsePreset(preset).layers[0]!.effects).toEqual(preset.layers[0]!.effects);
  for (const invalid of [{ eqLow: 13 }, { eqMid: NaN }, { drive: 1.1 }]) {
    const bad = structuredClone(preset); Object.assign(bad.layers[0]!.effects, invalid);
    expect(() => parsePreset(bad)).toThrow('invalid');
  }
});
it('normalizes conflicting legacy mute/solo state with mute priority', () => {
  const preset = structuredClone(pianoPreset); preset.layers[0]!.mute = true; preset.layers[0]!.solo = true;
  expect(parsePreset(preset).layers[0]).toMatchObject({ mute: true, solo: false });
});
it('bypass preserves controls and actually zeros sends / disables chorus', () => {
  const effects = addEffect(addEffect({ ...defaultLayerEffects, rack: [] }, 'reverb'), 'chorus');
  effects.reverbSend = 0.6; effects.chorusMix = 0.7;
  effects.rack = effects.rack!.map(slot => ({ ...slot, enabled: false }));
  expect(effectiveEffects(effects)).toMatchObject({ reverbSend: 0, chorusBypass: true, chorusMix: 0.7 });
  expect(effects.reverbSend).toBe(0.6);
  effects.rack[0]!.enabled = true; expect(effectiveEffects(effects).reverbSend).toBe(0.6);
});
it('rejects duplicate or excessive effects in imported data', () => {
  for (const rack of [[{ type: 'reverb', enabled: true }, { type: 'reverb', enabled: false }],
    [{ type: 'reverb', enabled: true }, { type: 'chorus', enabled: true }, { type: 'delay', enabled: false }],
    [{ type: 'unknown', enabled: true }]]) {
    const p = structuredClone(pianoPreset); Object.assign(p.layers[0]!.effects, { rack });
    expect(() => parsePreset(p)).toThrow('invalid');
  }
});
it('migrates old flat effects deterministically and keeps numeric values', () => {
  const p = structuredClone(pianoPreset), e = p.layers[0]!.effects;
  delete e.rack; e.chorusBypass = false; e.reverbSend = 0.5; e.delaySend = 0.4;
  const result = parsePreset(p).layers[0]!.effects;
  expect(effectRack(result).map(slot => slot.type)).toEqual(['filter', 'chorus']);
  expect(result.reverbSend).toBe(0.5); expect(result.delaySend).toBe(0.4);
});
