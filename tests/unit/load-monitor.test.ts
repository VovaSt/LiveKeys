import { expect, it } from 'vitest';
import { AudioLoadMonitor } from '../../src/audio-web/load-monitor';
import { createLayer, pianoPreset } from '../../src/domain/models';
import { parsePreset } from '../../src/domain/serialization';

it('detects audio stalls, holds warning, ignores suspension and hidden tabs', () => {
  const monitor = new AudioLoadMonitor();
  monitor.sample(0, 0, true, true);
  expect(monitor.sample(300, 0.3, true, true).audioOverloaded).toBe(false);
  expect(monitor.sample(600, 0.4, true, true).audioOverloaded).toBe(true);
  expect(monitor.sample(900, 0.7, true, true).audioOverloaded).toBe(true);
  expect(monitor.sample(3000, 2.8, true, true).audioOverloaded).toBe(false);
  expect(monitor.sample(3300, 2.8, false, true).audioOverloaded).toBe(false);
  expect(monitor.sample(4000, 2.8, true, false).audioOverloaded).toBe(false);
  expect(monitor.sample(5000, 2.8, true, true).audioOverloaded).toBe(false);
});
it('uses new browser underruns, not historical counts or main thread delays', () => {
  const monitor = new AudioLoadMonitor();
  expect(monitor.sample(0, 0, true, true, 5).audioOverloaded).toBe(false);
  expect(monitor.sample(300, 0, true, true, 5).audioOverloaded).toBe(false);
  expect(monitor.sample(600, 0.3, true, true, 6).audioOverloaded).toBe(true);
  expect(monitor.sample(3000, 2.7, true, true, 6).audioOverloaded).toBe(false);
});
it('defaults legacy pad polyphony to ten, persists values and rejects invalid limits', () => {
  const preset = { ...pianoPreset, layers: [createLayer('pad')] };
  delete preset.layers[0]!.voiceLimit;
  expect(parsePreset(preset).layers[0]!.voiceLimit).toBe(10);
  preset.layers[0]!.voiceLimit = 6;
  expect(parsePreset(JSON.parse(JSON.stringify(preset))).layers[0]!.voiceLimit).toBe(6);
  for (const value of [0, 33, 1.5, NaN]) {
    preset.layers[0]!.voiceLimit = value;
    expect(() => parsePreset(preset)).toThrow();
  }
});
