import { expect, it } from 'vitest';
import { createLayer, instruments, instrumentCategories, pianoPreset } from '../../src/domain/models';
import { parsePreset } from '../../src/domain/serialization';

it('places every instrument in exactly one of seven populated categories', () => {
  expect(instrumentCategories).toHaveLength(7);
  for (const category of instrumentCategories) expect(instruments.filter(i => i.category === category.id).length).toBeGreaterThan(0);
  for (const instrument of instruments) expect(instrumentCategories.filter(c => c.id === instrument.category)).toHaveLength(1);
  expect(instruments.filter(i => i.category === 'organ')).toHaveLength(3);
  expect(instruments.filter(i => i.category === 'orchestra')).toHaveLength(4);
});

it('opens bright pads while keeping warm pads mellow and preserving saved brightness', () => {
  for (const instrument of instruments.filter(i => i.category === 'pad')) {
    const layer = createLayer('pad', instrument);
    expect(layer.pad.cutoff).toBe(({ 'glass-pad': 4200, 'soft-air': 2400, 'strings-pad': 2200 } as Record<string, number>)[instrument.id] ?? 400);
    layer.pad.cutoff = 2700;
    expect(parsePreset({ ...pianoPreset, layers: [layer] }).layers[0]!.pad.cutoff).toBe(2700);
  }
});

it('uses sampled definitions for all pads and orchestral sounds', () => {
  const sampled = instruments.filter(i => ['pad', 'dynamic', 'orchestra'].includes(i.category!));
  expect(sampled).toHaveLength(13);
  for (const instrument of sampled) {
    expect(instrument.definition).toMatchObject({ kind: 'sampler', sustained: true });
  }
});
