import { expect, it } from 'vitest';
import { tubeGain, tubeTransfer } from '../../src/audio-web/tube-drive';
import { createLayer, instruments } from '../../src/domain/models';
import { factoryPresets } from '../../src/domain/factory';

it('has unity small-signal gain, smooth bounded response and asymmetric harmonics', () => {
  expect(tubeTransfer(0)).toBe(0);
  expect((tubeTransfer(0.0001) - tubeTransfer(-0.0001)) / 0.0002).toBeCloseTo(1, 5);
  expect(Math.abs(tubeTransfer(-0.7))).not.toBeCloseTo(tubeTransfer(0.7), 3);
  for (let i = -100; i < 100; i++) {
    const a = tubeTransfer(i / 100), b = tubeTransfer((i + 1) / 100);
    expect(b).toBeGreaterThan(a); expect(b - a).toBeLessThan(0.011);
    expect(Math.abs(a)).toBeLessThan(1);
  }
});
it('adds much less harmonic distortion than the old drive at the same setting', () => {
  const amount = 0.7, gain = tubeGain(amount);
  let harmonic = 0, oldHarmonic = 0;
  for (let i = 0; i < 4096; i++) {
    const phase = 2 * Math.PI * i / 4096, x = 0.4 * Math.sin(phase);
    harmonic += tubeTransfer(x * gain) / gain * Math.sin(3 * phase);
    oldHarmonic += Math.tanh(x * (1 + amount * 15) * 2) / Math.tanh(2) / Math.sqrt(1 + amount * 15) * Math.sin(3 * phase);
  }
  expect(Math.abs(harmonic)).toBeGreaterThan(1);
  expect(Math.abs(harmonic)).toBeLessThan(Math.abs(oldHarmonic) * 0.5);
});
it('enables gentle Drive on Rhodes defaults and both factory arrangements within two slots', () => {
  const defaults = createLayer('rhodes', instruments.find(i => i.id === 'rhodes')!);
  for (const layer of [defaults, ...factoryPresets.flatMap(p => p.layers).filter(l => l.instrument.id === 'rhodes')]) {
    expect(layer.effects.rack).toContainEqual({ type: 'drive', enabled: true });
    expect(layer.effects.rack!.length).toBeLessThanOrEqual(2);
    expect(layer.effects.drive).toBeGreaterThan(0); expect(layer.effects.drive).toBeLessThanOrEqual(0.35);
  }
});
