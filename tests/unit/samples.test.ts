import { describe, expect, it } from 'vitest';
import { dbToGain, selectZone } from '../../src/audio-web/samples';
import type { SampleZone } from '../../src/domain/models';
describe('sample mapping', () => {
  const zones: SampleZone[] = [48, 60, 72].flatMap(rootNote => [0, 1].map(layer => ({
    id: `${rootNote}-${layer}`, rootNote, url: '', keyRange: [0, 127],
    velocityRange: layer ? [65, 127] : [1, 64], tuningCents: 0, gainDb: 0
  })));
  it('chooses nearest root inside inclusive velocity zone', () => {
    expect(selectZone(zones, 62, 64)?.id).toBe('60-0');
    expect(selectZone(zones, 62, 65)?.id).toBe('60-1');
    expect(selectZone(zones, 71, 127)?.id).toBe('72-1');
    expect(selectZone(zones, 60, 0)).toBeUndefined();
  });
  it('master mute and decibel conversion', () => {
    expect(dbToGain(-60)).toBe(0); expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501187);
  });
});
